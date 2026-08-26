import { parseCommandPayload, type CommandName, type CommandResult } from "@hemlogik/connect-protocol";
import { callService, getHaConfig, type SupervisorCoreSocket } from "./supervisor-client";
import { listLogs } from "./logs";
import { buildInventorySnapshot } from "./inventory";
import { hasTunnelToken } from "./credential-store";
import { config } from "./config";
import { logger } from "./logger";

/**
 * Executes one narrow command from the Gateway. call_service's domain+service allowlist is
 * re-checked HERE - layer 3 of 3 (AGENTS spec s19/s48) - independently of the portal Server
 * Action's check and the Gateway Durable Object's own re-check, so a compromised/spoofed Gateway
 * still can't turn this into an arbitrary Supervisor/HA command channel. The check happens via
 * parseCommandPayload below (callServicePayloadSchema's own domain+service refinement) - by the
 * time execution reaches the "call_service" case, an invalid domain/service pair has already
 * thrown and returned invalid_payload, so there's no separate allowlist check needed there.
 */
export async function executeCommand(command: CommandName, rawPayload: unknown, socket: SupervisorCoreSocket): Promise<CommandResult> {
  let payload: unknown;
  try {
    payload = parseCommandPayload(command, rawPayload);
  } catch {
    return { ok: false, errorCode: "invalid_payload", errorMessage: "Payload failed schema validation" };
  }

  try {
    switch (command) {
      case "ping":
        return { ok: true };

      case "get_installation_info": {
        const haConfig = await getHaConfig();
        return { ok: true, data: { haVersion: haConfig.version, agentVersion: config.agentVersion } };
      }

      case "diagnostics": {
        const haConfig = await getHaConfig().catch(() => null);
        return {
          ok: true,
          data: {
            haVersion: haConfig?.version ?? null,
            agentVersion: config.agentVersion,
            cloudflaredRunning: hasTunnelToken(),
          },
        };
      }

      case "refresh_inventory": {
        const snapshot = await buildInventorySnapshot(socket);
        return { ok: true, data: snapshot };
      }

      case "get_state": {
        const { entityId } = payload as { entityId: string };
        const res = await fetch(`${config.supervisorBaseUrl}/core/api/states/${entityId}`, {
          headers: { Authorization: `Bearer ${config.supervisorToken}` },
        });
        if (!res.ok) return { ok: false, errorCode: "not_found", errorMessage: `No such entity: ${entityId}` };
        return { ok: true, data: await res.json() };
      }

      case "call_service": {
        const { domain, service, entityId, data } = payload as { domain: string; service: string; entityId: string; data?: Record<string, unknown> };
        await callService(domain, service, entityId, data);
        return { ok: true };
      }

      case "get_logs": {
        const entries = await listLogs(socket);
        return { ok: true, data: { entries } };
      }

      default:
        return { ok: false, errorCode: "unknown_command" };
    }
  } catch (err) {
    logger.error(`Command ${command} failed`, err);
    return { ok: false, errorCode: "execution_failed", errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
