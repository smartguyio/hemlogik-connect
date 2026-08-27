import { makeEnvelope } from "@hemlogik/connect-protocol";
import { config } from "./config";
import { logger } from "./logger";
import { loadCredential } from "./credential-store";
import { enroll } from "./enrollment";
import { SupervisorCoreSocket, getHaConfig } from "./supervisor-client";
import { GatewayClient } from "./gateway-client";
import { buildInventorySnapshot } from "./inventory";
import { listLogs } from "./logs";
import { shouldForwardStateEvent } from "./events";

const SELF_HEAL_INTERVAL_MS = 30 * 60 * 1000; // AGENTS spec s17/s22 - periodic resync without being told to, on top of on-demand refresh_inventory
const SETTLE_RESYNC_DELAY_MS = 90 * 1000; // one extra startup-only resync - see its call site below
const RETRY_DELAY_MS = 5000;

async function main(): Promise<void> {
  logger.info(`Hemlogik Connect agent starting (version ${config.agentVersion})`);

  let stored = await loadCredential();
  if (!stored) {
    logger.info("Not yet paired - submitting configured enrollment key...");
    stored = await retryUntilSuccess(() => enroll(), "enrollment");
  }

  const socket = new SupervisorCoreSocket();
  await retryUntilSuccess(() => socket.connect(), "Supervisor Core WebSocket connection");
  logger.info("Connected to Home Assistant Core via the Supervisor proxy");

  const gateway = new GatewayClient(stored.credential, socket);
  await gateway.connect();

  const haConfig = await getHaConfig().catch(() => null);
  gateway.setHaVersion(haConfig?.version ?? null);

  let knownEntityIds = new Set<string>();

  async function resync(): Promise<void> {
    try {
      const snapshot = await buildInventorySnapshot(socket);
      knownEntityIds = new Set(snapshot.entities.map((e) => e.ha_entity_id));
      gateway.sendEnvelope(makeEnvelope("inventory", snapshot));
      logger.debug(`Inventory resynced: ${snapshot.areas.length} areas, ${snapshot.devices.length} devices, ${snapshot.entities.length} entities`);
    } catch (err) {
      logger.error("Inventory resync failed", err);
    }
  }

  await resync();
  // One extra "settle" resync shortly after startup, on top of the immediate one above and the
  // regular SELF_HEAL_INTERVAL_MS cadence below - specifically for right after this agent's own
  // update just installed (see commands.ts's call_service fire-and-forget handling for
  // update.install): Supervisor's own update-entity bookkeeping can still be catching up at the
  // exact moment the fresh agent's first resync fires, and this catches that without making every
  // other, unrelated startup wait up to SELF_HEAL_INTERVAL_MS (30 min) for it to self-correct.
  setTimeout(resync, SETTLE_RESYNC_DELAY_MS);
  setInterval(resync, SELF_HEAL_INTERVAL_MS);

  /**
   * Same cadence and same "unsolicited push, not just on-demand" idea as resync() above -
   * pushing this periodically rather than only ever in response to a get_logs command is what
   * keeps the portal's stored-log fallback fresh independent of whether anyone had the Logs tab
   * open while this connector was still online (the moment that matters most for looking at logs
   * is often right after something's already gone offline).
   */
  async function pushLogs(): Promise<void> {
    try {
      const entries = await listLogs(socket);
      gateway.sendEnvelope(makeEnvelope("logs", { entries }));
      logger.debug(`Logs pushed: ${entries.length} entries`);
    } catch (err) {
      logger.error("Periodic log push failed", err);
    }
  }

  await pushLogs();
  setInterval(pushLogs, SELF_HEAL_INTERVAL_MS);

  // Remote-access-only mode: knownEntityIds is always empty (buildInventorySnapshot short-
  // circuits, see inventory.ts), so shouldForwardStateEvent would never forward anything anyway -
  // skip the subscription itself rather than run it as a permanent no-op.
  if (config.enableDeviceSync) {
    await socket.subscribeStateChanged((event) => {
      if (!event.new_state || !shouldForwardStateEvent(event.entity_id, knownEntityIds)) return;
      gateway.sendStateEvent({
        ha_entity_id: event.entity_id,
        state: event.new_state.state,
        attributes: event.new_state.attributes,
        last_changed: event.new_state.last_changed,
      });
    });
  }

  logger.info("Hemlogik Connect agent is running.");
}

async function retryUntilSuccess<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      logger.warning(`${label} failed, retrying in ${RETRY_DELAY_MS}ms: ${err instanceof Error ? err.message : String(err)}`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down.");
  process.exit(0);
});

main().catch((err) => {
  logger.error("Fatal error - exiting so s6 restarts the agent", err);
  process.exit(1);
});
