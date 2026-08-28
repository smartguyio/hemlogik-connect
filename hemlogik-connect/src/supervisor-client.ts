import WebSocket from "ws";
import { config } from "./config";
import { logger } from "./logger";

/**
 * Talks to Home Assistant Core exclusively via the Supervisor's proxy - REST at
 * `{supervisor}/core/api/...` and WebSocket at `{supervisor}/core/websocket`, both authenticated
 * with the locally-supplied SUPERVISOR_TOKEN. This is the supported mechanism
 * (`homeassistant_api: true` in config.yaml) - never a manually-created Home Assistant Long-Lived
 * Access Token (AGENTS spec s12). The token never leaves this process: it's read once from the
 * environment and used only for these local calls.
 */

export interface HaState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

export interface HaSystemLogEntry {
  name: string;
  message: string | string[];
  level: string;
  timestamp: number;
  exception?: string;
  count?: number;
}

/** Thrown by restFetch on a non-2xx response - carries the real HTTP status so callers (like commands.ts's automation-config handling) can distinguish e.g. 404 "no such config id" from a genuine failure, same distinction the portal's old HaClientError made. */
export class SupervisorApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "SupervisorApiError";
  }
}

async function restFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${config.supervisorBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.supervisorToken}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (!res.ok) {
    throw new SupervisorApiError(res.status, `Supervisor Core API ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function getStates(): Promise<HaState[]> {
  return restFetch<HaState[]>("/core/api/states");
}

export async function getHaConfig(): Promise<{ version: string; location_name?: string }> {
  return restFetch("/core/api/config");
}

export async function callService(domain: string, service: string, entityId: string, data?: Record<string, unknown>): Promise<void> {
  await restFetch(`/core/api/services/${domain}/${service}`, {
    method: "POST",
    body: JSON.stringify({ entity_id: entityId, ...data }),
  });
}

/**
 * GET /api/config/automation/config/{id} - an automation's raw config (trigger/condition/action/
 * etc), keyed by its config `id` (the entity's `id` attribute - NOT its entity_id). Only
 * automations created with an explicit id are reachable this way; HA returns 404 otherwise - a
 * straight port of the same call the portal's own integrations/home-assistant/client.server.ts
 * already makes for the old pull-based integration, just reached through Supervisor's proxy here
 * instead of a customer-supplied base URL + token.
 */
export async function getAutomationConfig(configId: string): Promise<Record<string, unknown>> {
  return restFetch<Record<string, unknown>>(`/core/api/config/automation/config/${encodeURIComponent(configId)}`);
}

/** POST /api/config/automation/config/{id} - replaces an automation's config wholesale. */
export async function setAutomationConfig(configId: string, newConfig: Record<string, unknown>): Promise<void> {
  await restFetch(`/core/api/config/automation/config/${encodeURIComponent(configId)}`, {
    method: "POST",
    body: JSON.stringify(newConfig),
  });
}

/**
 * A minimal request/response wrapper over HA's WebSocket API - used only for the handful of
 * commands the REST API doesn't expose (area/device/entity registries, event subscription), same
 * rationale as this monorepo's existing integrations/home-assistant/websocket.server.ts. Uses the
 * `ws` package here (a real Node.js process, unlike that Cloudflare Workers client - see its own
 * comment for why `ws` specifically doesn't work there but is the right choice here).
 */
const MAX_RECONNECT_DELAY_MS = 60_000;

export class SupervisorCoreSocket {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>();
  private eventHandlers = new Set<(event: { entity_id: string; new_state: HaState | null }) => void>();
  private reconnectDelayMs = 1000;
  /** Set by close() - stops the reconnect loop below from firing after an intentional shutdown
   * (close() isn't called anywhere in this codebase today, SIGTERM just exits the whole process
   * directly, but a "close() means stay closed" guard is basic hygiene for whenever that changes). */
  private closing = false;

  /**
   * Resolves once the FIRST connection opens (matches GatewayClient.connect's own convention, see
   * its comment) - callers that need to send something right after startup must await this.
   * Automatic reconnects after a later disconnect do NOT re-resolve/reject this same promise;
   * before this, a dropped Supervisor connection was never retried at all - every resync() from
   * then on (the 90s startup settle, and every SELF_HEAL_INTERVAL_MS after) failed forever with
   * "Supervisor Core WebSocket is not connected" until the whole agent process was restarted. Real
   * production symptom, not hypothetical: Home Assistant Core itself restarting (an update, a
   * config reload) drops this connection independently of the agent's own lifecycle or its
   * separate connection to Hemlogik Cloud.
   */
  connect(): Promise<void> {
    return new Promise((resolveFirstConnect, rejectFirstConnect) => {
      const attempt = (isFirstAttempt: boolean) => {
        const wsUrl = `${config.supervisorBaseUrl.replace(/^http/, "ws")}/core/websocket`;
        const ws = new WebSocket(wsUrl);
        this.ws = ws;

        ws.on("message", (raw) => {
          const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
          if (msg.type === "auth_required") {
            ws.send(JSON.stringify({ type: "auth", access_token: config.supervisorToken }));
          } else if (msg.type === "auth_ok") {
            this.reconnectDelayMs = 1000;
            if (isFirstAttempt) {
              resolveFirstConnect();
            } else if (this.eventHandlers.size > 0) {
              // A fresh WebSocket connection carries none of the previous one's subscriptions -
              // re-issue it so state-change forwarding (events.ts) doesn't silently go quiet after
              // a reconnect the same way inventory resync used to.
              void this.send({ type: "subscribe_events", event_type: "state_changed" }).catch((err) =>
                logger.error("Failed to resubscribe to state_changed after Supervisor reconnect", err)
              );
            }
          } else if (msg.type === "auth_invalid") {
            const err = new Error("Supervisor Core WebSocket auth failed");
            if (isFirstAttempt) rejectFirstConnect(err);
            else logger.error("Supervisor Core WebSocket auth failed on reconnect", err);
          } else if (msg.type === "result" && typeof msg.id === "number") {
            const pending = this.pending.get(msg.id);
            if (!pending) return;
            this.pending.delete(msg.id);
            if (msg.success) pending.resolve(msg.result);
            else pending.reject(new Error(JSON.stringify(msg.error)));
          } else if (msg.type === "event" && typeof msg.id === "number") {
            const event = (msg.event as Record<string, unknown>)?.data as { entity_id: string; new_state: HaState | null } | undefined;
            if (event) for (const handler of this.eventHandlers) handler(event);
          }
        });
        ws.on("error", (err) => {
          logger.error("Supervisor Core WebSocket error", err);
          if (isFirstAttempt) rejectFirstConnect(err);
        });
        ws.on("close", () => {
          this.ws = null;
          // Never leave a caller awaiting a response that can now never arrive - resync() and
          // friends already tolerate a rejected send() (they're wrapped in try/catch), but without
          // this they'd hang indefinitely instead.
          for (const { reject } of this.pending.values()) reject(new Error("Supervisor Core WebSocket disconnected"));
          this.pending.clear();
          if (this.closing) return;
          logger.warning(`Disconnected from Supervisor Core WebSocket - reconnecting in ${this.reconnectDelayMs}ms`);
          setTimeout(() => attempt(false), this.reconnectDelayMs);
          this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        });
      };
      attempt(true);
    });
  }

  private send(command: Record<string, unknown>): Promise<unknown> {
    if (!this.ws) throw new Error("Supervisor Core WebSocket is not connected");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws!.send(JSON.stringify({ id, ...command }));
    });
  }

  async listAreas(): Promise<Array<{ area_id: string; name: string }>> {
    return this.send({ type: "config/area_registry/list" }) as Promise<Array<{ area_id: string; name: string }>>;
  }

  /**
   * `name` is the manufacturer/integration-supplied default ("Sunricher HK-SL-DIM-A"); when a
   * user renames a device in HA's UI, that rename lands in `name_by_user`, NOT `name` - HA's own
   * frontend always prefers name_by_user when it's set, falling back to name otherwise. Missing
   * this field was a real reported bug: Connect's device list showed the raw manufacturer name
   * even for devices the customer had explicitly renamed.
   */
  async listDevices(): Promise<
    Array<{
      id: string;
      area_id: string | null;
      name: string | null;
      name_by_user: string | null;
      manufacturer: string | null;
      model: string | null;
      /** "service" marks a logical device representing an integration/hub itself (e.g. an HA
       *  add-on's own diagnostics device, an MQTT broker's own device) rather than a physical
       *  device - inventory.ts drops these entirely, matching the old pull-based integration's
       *  own exclusion (its devices.server.ts's HaDeviceRegistryEntry). */
      entry_type: string | null;
    }>
  > {
    return this.send({ type: "config/device_registry/list" }) as Promise<
      Array<{
        id: string;
        area_id: string | null;
        name: string | null;
        name_by_user: string | null;
        manufacturer: string | null;
        model: string | null;
        entry_type: string | null;
      }>
    >;
  }

  async listEntities(): Promise<
    Array<{ entity_id: string; device_id: string | null; area_id: string | null; entity_category: string | null }>
  > {
    return this.send({ type: "config/entity_registry/list" }) as Promise<
      Array<{ entity_id: string; device_id: string | null; area_id: string | null; entity_category: string | null }>
    >;
  }

  async subscribeStateChanged(handler: (event: { entity_id: string; new_state: HaState | null }) => void): Promise<void> {
    this.eventHandlers.add(handler);
    await this.send({ type: "subscribe_events", event_type: "state_changed" });
  }

  /**
   * Home Assistant removed the documented REST `/api/error_log` endpoint in recent versions
   * (confirmed against developers.home-assistant.io - still listed in older docs, 404s on
   * current installs). `system_log/list` over the WebSocket API is the supported replacement,
   * and returns already-structured entries rather than a plaintext blob to regex-parse - same
   * finding this monorepo's own integrations/home-assistant/logs.server.ts already made; see
   * ./logs.ts for the mapping into the shared LogEntry shape.
   */
  async listRawSystemLog(): Promise<HaSystemLogEntry[]> {
    return this.send({ type: "system_log/list" }) as Promise<HaSystemLogEntry[]>;
  }

  /**
   * WS-only, no REST equivalent - "trace/list" is how HA's own automation editor gets an
   * automation's recent run history. Returned raw/loosely-typed on purpose (undocumented-ish
   * internal API, see ./automation-traces.ts's own comment for why); the mapping into the shared
   * AutomationTraceSummary shape happens there, not here.
   */
  async listAutomationTraces(configId: string): Promise<unknown> {
    return this.send({ type: "trace/list", domain: "automation", item_id: configId });
  }

  close(): void {
    this.closing = true;
    this.ws?.close();
    this.ws = null;
  }
}
