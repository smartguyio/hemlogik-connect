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
    throw new Error(`Supervisor Core API ${path} failed: ${res.status} ${await res.text().catch(() => "")}`);
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
 * A minimal request/response wrapper over HA's WebSocket API - used only for the handful of
 * commands the REST API doesn't expose (area/device/entity registries, event subscription), same
 * rationale as this monorepo's existing integrations/home-assistant/websocket.server.ts. Uses the
 * `ws` package here (a real Node.js process, unlike that Cloudflare Workers client - see its own
 * comment for why `ws` specifically doesn't work there but is the right choice here).
 */
export class SupervisorCoreSocket {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private pending = new Map<number, { resolve: (result: unknown) => void; reject: (err: Error) => void }>();
  private eventHandlers = new Set<(event: { entity_id: string; new_state: HaState | null }) => void>();

  async connect(): Promise<void> {
    const wsUrl = `${config.supervisorBaseUrl.replace(/^http/, "ws")}/core/websocket`;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
        if (msg.type === "auth_required") {
          ws.send(JSON.stringify({ type: "auth", access_token: config.supervisorToken }));
        } else if (msg.type === "auth_ok") {
          resolve();
        } else if (msg.type === "auth_invalid") {
          reject(new Error("Supervisor Core WebSocket auth failed"));
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
        reject(err);
      });
      ws.on("close", () => {
        this.ws = null;
      });
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

  async listDevices(): Promise<Array<{ id: string; area_id: string | null; name: string | null; manufacturer: string | null; model: string | null }>> {
    return this.send({ type: "config/device_registry/list" }) as Promise<
      Array<{ id: string; area_id: string | null; name: string | null; manufacturer: string | null; model: string | null }>
    >;
  }

  async listEntities(): Promise<Array<{ entity_id: string; device_id: string | null; area_id: string | null }>> {
    return this.send({ type: "config/entity_registry/list" }) as Promise<
      Array<{ entity_id: string; device_id: string | null; area_id: string | null }>
    >;
  }

  async subscribeStateChanged(handler: (event: { entity_id: string; new_state: HaState | null }) => void): Promise<void> {
    this.eventHandlers.add(handler);
    await this.send({ type: "subscribe_events", event_type: "state_changed" });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
