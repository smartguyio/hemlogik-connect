import type { InventorySnapshot } from "@hemlogik/connect-protocol";
import { getStates } from "./supervisor-client";
import type { SupervisorCoreSocket } from "./supervisor-client";
import { config } from "./config";

const EMPTY_SNAPSHOT: InventorySnapshot = { areas: [], devices: [], entities: [] };

/**
 * HA's own update entity for THIS add-on (title "Hemlogik Connect" - locale-independent, unlike
 * its entity_id, which gets a language-dependent suffix: confirmed live as
 * "update.hemlogik_connect_uppdatering" on a Swedish-locale instance, would be
 * "update.hemlogik_connect_update" on an English one) can lag behind an actual restart -
 * confirmed live: after this agent had already restarted running 0.6.0, Supervisor's own
 * bookkeeping for the add-on's update entity still reported installed_version 0.5.1, and kept
 * reporting it - no amount of re-fetching from us surfaces anything different, since HA/Supervisor
 * itself hadn't updated what it believes yet. We know our own version for certain (it's literally
 * the code executing right now), so correct the obviously-stale reading before it's ever synced
 * upstream, rather than faithfully relaying data we know is wrong. Only ever touches this one
 * entity (matched by title, not guessed at for anything else) - every other update entity's data
 * is passed through completely untouched.
 */
function correctOwnUpdateEntity(
  domain: string,
  entityState: string | null,
  attributes: Record<string, unknown>
): { entityState: string | null; attributes: Record<string, unknown> } {
  if (domain !== "update" || attributes.title !== "Hemlogik Connect" || attributes.installed_version === config.agentVersion) {
    return { entityState, attributes };
  }

  const corrected: Record<string, unknown> = { ...attributes, installed_version: config.agentVersion };
  const latestVersion = corrected.latest_version;
  const stillNeedsUpdate = typeof latestVersion !== "string" || latestVersion !== config.agentVersion;
  return { entityState: stillNeedsUpdate ? entityState : "off", attributes: corrected };
}

/**
 * Builds a full inventory snapshot (areas -> devices -> entities, respecting HA's real model) for
 * the `refresh_inventory` command result - see ha_areas/ha_devices/ha_entities in the main repo's
 * 0051_connect_ha_inventory.sql for how this gets stored. Always a full resync, never a delta.
 *
 * The single point of truth for remote-access-only mode (config.enableDeviceSync === false) -
 * both index.ts's periodic resync() and commands.ts's on-demand refresh_inventory command already
 * funnel through this one function, so gating it here covers both without duplicating the check.
 * Returns empty rather than throwing so a connector that's ALREADY synced devices and then gets
 * switched to remote-access-only correctly clears out to empty on its very next resync, instead of
 * leaving stale device data cached forever.
 */
export async function buildInventorySnapshot(socket: SupervisorCoreSocket): Promise<InventorySnapshot> {
  if (!config.enableDeviceSync) return EMPTY_SNAPSHOT;

  const [states, areas, devices, entities] = await Promise.all([
    getStates(),
    socket.listAreas(),
    socket.listDevices(),
    socket.listEntities(),
  ]);

  const stateByEntityId = new Map(states.map((s) => [s.entity_id, s]));

  // "service" devices are an integration/hub's own logical pseudo-device (an HA add-on's own
  // diagnostics device, an MQTT broker's own device, etc.) - never a physical device a technician
  // would want to see as a card. Drop them, matching the old pull-based integration's own
  // exclusion exactly - but NOT their update.* entities: confirmed live, this was silently
  // dropping every add-on/HACS update entity's ongoing sync entirely (Hemlogik Connect's own
  // included - the actual root cause behind a real "stuck update" report, not the earlier fixes
  // in this area, which were all real but never even got the chance to run since this filter
  // removed the entity before they'd ever see it). An add-on's own pseudo-device should never
  // become a device card, but its update entity is exactly what the Updates tab exists for -
  // dropping the device (below) already keeps it from ever being offered as a card;
  // Gateway's applyInventorySnapshot already null-safes an entity's device_id that isn't in the
  // synced device set, so this entity simply becomes "unassigned" rather than needing any extra
  // handling here.
  const serviceDeviceIds = new Set(devices.filter((d) => d.entry_type === "service").map((d) => d.id));
  const physicalDevices = devices.filter((d) => !serviceDeviceIds.has(d.id));
  const keptEntities = entities.filter(
    (e) => !e.device_id || !serviceDeviceIds.has(e.device_id) || e.entity_id.startsWith("update.")
  );

  return {
    areas: areas.map((a) => ({ ha_area_id: a.area_id, name: a.name })),
    devices: physicalDevices.map((d) => ({
      ha_device_id: d.id,
      ha_area_id: d.area_id ?? undefined,
      // name_by_user (the customer's own rename, if any) wins over the manufacturer default -
      // see supervisor-client.ts's listDevices() comment. `||`, deliberately not `??`: some
      // integrations (Tuya's cloud integration in particular) leave `name` as an empty string
      // rather than null when they never populated one - `??` only skips null/undefined, so it
      // was stopping at that empty string instead of falling through to the device id, syncing a
      // literally blank name. A device name is never legitimately "" as a real value, so treating
      // any falsy value the same way here is correct, not just a workaround for this one case.
      name: d.name_by_user || d.name || d.id,
      manufacturer: d.manufacturer ?? undefined,
      model: d.model ?? undefined,
    })),
    entities: keptEntities.map((e) => {
      const state = stateByEntityId.get(e.entity_id);
      const domain = e.entity_id.split(".")[0] ?? "unknown";
      const { entityState, attributes } = correctOwnUpdateEntity(domain, state?.state ?? null, state?.attributes ?? {});
      return {
        ha_entity_id: e.entity_id,
        ha_device_id: e.device_id ?? undefined,
        ha_area_id: e.area_id ?? undefined,
        domain,
        friendly_name: typeof state?.attributes.friendly_name === "string" ? state.attributes.friendly_name : undefined,
        state: entityState,
        attributes,
        available: state ? state.state !== "unavailable" : false,
        entity_category: e.entity_category === "diagnostic" || e.entity_category === "config" ? e.entity_category : null,
      };
    }),
  };
}
