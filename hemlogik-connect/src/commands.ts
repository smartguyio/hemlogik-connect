import { parseCommandPayload, type CommandName, type CommandResult } from "@hemlogik/connect-protocol";
import { callService, getAutomationConfig, setAutomationConfig, getHaConfig, SupervisorApiError, type SupervisorCoreSocket } from "./supervisor-client";
import { listLogs } from "./logs";
import { listAutomationTraces } from "./automation-traces";
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
/**
 * Commands that read or act on home-automation data - refused outright in remote-access-only mode
 * (config.enableDeviceSync === false, see config.yaml's option doc comment), independently of
 * whatever the portal does or doesn't show (same "re-check at every layer" discipline as the
 * call_service domain allowlist above). refresh_inventory/get_logs are NOT in this set - they
 * already self-gate to an empty result via inventory.ts/logs.ts, which is the correct behavior for
 * "there's nothing to sync" rather than an error, since the portal's own periodic/on-demand calls
 * to those two are harmless either way.
 */
const DEVICE_SYNC_COMMANDS = new Set<CommandName>([
  "call_service",
  "get_state",
  "get_automation_config",
  "set_automation_config",
  "get_automation_traces",
]);

export async function executeCommand(command: CommandName, rawPayload: unknown, socket: SupervisorCoreSocket): Promise<CommandResult> {
  let payload: unknown;
  try {
    payload = parseCommandPayload(command, rawPayload);
  } catch {
    return { ok: false, errorCode: "invalid_payload", errorMessage: "Payload failed schema validation" };
  }

  if (!config.enableDeviceSync && DEVICE_SYNC_COMMANDS.has(command)) {
    return { ok: false, errorCode: "device_sync_disabled", errorMessage: "Device/entity sync is disabled on this installation (remote access only)." };
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

        // update.install can be THIS add-on updating itself - Supervisor stops/replaces the very
        // container this fetch is running inside partway through, so the request can structurally
        // never resolve (the process answering it is gone). Awaiting it here would mean this
        // command - and the Gateway's pending row for it - never completes, staying stuck
        // "pending" forever (confirmed: this is exactly what caused a real stuck-update report).
        // Fire the request and return ok as soon as it's sent; whether the install actually
        // succeeded is verified by the next resync once the (possibly new) agent process starts
        // up, not by this call's result - true of any update.install, not just this add-on's own,
        // since any add-on/HA-core update can plausibly restart something this request depends on.
        if (domain === "update" && service === "install") {
          callService(domain, service, entityId, data).catch((err) => logger.warning(`update.install request errored (may be expected if it restarted something): ${err instanceof Error ? err.message : String(err)}`));
          return { ok: true };
        }

        await callService(domain, service, entityId, data);
        return { ok: true };
      }

      case "get_logs": {
        const entries = await listLogs(socket);
        return { ok: true, data: { entries } };
      }

      case "get_automation_config": {
        const { configId } = payload as { configId: string };
        const raw = await getAutomationConfig(configId);
        return { ok: true, data: raw };
      }

      case "set_automation_config": {
        const { configId, config: automationConfig } = payload as { configId: string; config: Record<string, unknown> };
        await setAutomationConfig(configId, automationConfig);
        return { ok: true };
      }

      case "get_automation_traces": {
        const { configId } = payload as { configId: string };
        const traces = await listAutomationTraces(socket, configId);
        return { ok: true, data: { traces } };
      }

      default:
        return { ok: false, errorCode: "unknown_command" };
    }
  } catch (err) {
    logger.error(`Command ${command} failed`, err);
    // A 404 from the automation config API specifically means "no explicit id: field" - a normal,
    // expected condition (not every automation has one), so it gets its own errorCode + friendly
    // message rather than the generic execution_failed, same distinction the portal's old
    // automation-config-actions.ts's HaClientError handling made.
    if (err instanceof SupervisorApiError && err.status === 404 && (command === "get_automation_config" || command === "set_automation_config")) {
      return {
        ok: false,
        errorCode: "not_found",
        errorMessage: 'Den här automationen har inget config-id och kan inte redigeras via API:et (vanligtvis automationer skapade utan "id:" i YAML).',
      };
    }
    return { ok: false, errorCode: "execution_failed", errorMessage: err instanceof Error ? err.message : String(err) };
  }
}
