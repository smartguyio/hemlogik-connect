import WebSocket from "ws";
import {
  makeEnvelope,
  parseEnvelope,
  configPushPayloadSchema,
  HEARTBEAT_INTERVAL_MS,
  type CommandName,
} from "@hemlogik/connect-protocol";
import { config } from "./config";
import { logger } from "./logger";
import { saveTunnelToken, hasTunnelToken } from "./credential-store";
import { executeCommand } from "./commands";
import type { SupervisorCoreSocket } from "./supervisor-client";

const MAX_RECONNECT_DELAY_MS = 60_000;

/**
 * The agent's persistent outbound connection to the Connect Gateway Worker (AGENTS spec s14) -
 * no inbound port is ever opened on the customer's network for this. Reconnects with exponential
 * backoff on any drop; the Gateway's own offline-detection alarm (not this client) is the
 * authority on when a connector is actually "offline" (AGENTS spec s16).
 */
export class GatewayClient {
  private ws: WebSocket | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private reconnectDelayMs = 1000;
  private startedAt = Date.now();
  private lastKnownHaVersion: string | null = null;

  constructor(
    private credential: string,
    private socket: SupervisorCoreSocket
  ) {}

  setHaVersion(version: string | null): void {
    this.lastKnownHaVersion = version;
  }

  /**
   * Resolves once the FIRST connection opens (callers that need to send something right after
   * startup - e.g. index.ts's initial inventory resync - must await this; sendEnvelope silently
   * drops anything sent before the socket is actually open, same as a dropped frame on a real
   * network blip, so racing ahead of it would silently lose that first push). Automatic
   * reconnects after a later disconnect do NOT re-resolve/reject this same promise - they're
   * fire-and-forget, tolerated by the periodic self-heal resync in index.ts instead.
   */
  connect(): Promise<void> {
    return new Promise((resolveFirstConnect) => {
      const attempt = (isFirstAttempt: boolean) => {
        const wsUrl = `${config.gatewayHttpUrl.replace(/^http/, "ws")}/v1/agent`;
        const ws = new WebSocket(wsUrl, { headers: { Authorization: `Bearer ${this.credential}` } });
        this.ws = ws;

        ws.on("open", () => {
          logger.info("Connected to Hemlogik Cloud");
          this.reconnectDelayMs = 1000;
          this.startHeartbeat();
          if (isFirstAttempt) resolveFirstConnect();
        });
        ws.on("message", (raw) => {
          this.handleMessage(raw.toString()).catch((err) => logger.error("Failed to handle Gateway message", err));
        });
        ws.on("close", (code) => {
          logger.warning(`Disconnected from Hemlogik Cloud (code ${code}) - reconnecting in ${this.reconnectDelayMs}ms`);
          this.stopHeartbeat();
          setTimeout(() => attempt(false), this.reconnectDelayMs);
          this.reconnectDelayMs = Math.min(this.reconnectDelayMs * 2, MAX_RECONNECT_DELAY_MS);
        });
        ws.on("error", (err) => logger.error("Gateway WebSocket error", err));
      };
      attempt(true);
    });
  }

  private startHeartbeat(): void {
    this.sendHeartbeat();
    this.heartbeatTimer = setInterval(() => this.sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private sendHeartbeat(): void {
    this.sendEnvelope(
      makeEnvelope("heartbeat", {
        ha_core_version: this.lastKnownHaVersion ?? undefined,
        agent_version: config.agentVersion,
        cloudflared_running: hasTunnelToken(),
        agent_uptime_seconds: Math.floor((Date.now() - this.startedAt) / 1000),
      })
    );
  }

  sendEnvelope(envelope: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(envelope));
  }

  sendStateEvent(payload: { ha_entity_id: string; state: string | null; attributes: Record<string, unknown>; last_changed?: string }): void {
    this.sendEnvelope(makeEnvelope("event", payload));
  }

  private async handleMessage(raw: string): Promise<void> {
    let envelope;
    try {
      envelope = parseEnvelope(JSON.parse(raw));
    } catch {
      return; // malformed frame - drop it
    }

    if (envelope.type === "command") {
      const { command, payload } = envelope.payload as { command: CommandName; payload: unknown };
      const result = await executeCommand(command, payload, this.socket);
      this.sendEnvelope(makeEnvelope("command_result", result, envelope.id));
      return;
    }

    if (envelope.type === "config") {
      const parsed = configPushPayloadSchema.safeParse(envelope.payload);
      if (parsed.success && parsed.data.tunnelToken) {
        await saveTunnelToken(parsed.data.tunnelToken);
        logger.info("Remote access tunnel token received - cloudflared will pick it up shortly.");
      }
    }
  }
}
