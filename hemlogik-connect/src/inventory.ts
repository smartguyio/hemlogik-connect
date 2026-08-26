import type { InventorySnapshot } from "@hemlogik/connect-protocol";
import { getStates } from "./supervisor-client";
import type { SupervisorCoreSocket } from "./supervisor-client";

/** Builds a full inventory snapshot (areas -> devices -> entities, respecting HA's real model) for the `refresh_inventory` command result - see ha_areas/ha_devices/ha_entities in the main repo's 0051_connect_ha_inventory.sql for how this gets stored. Always a full resync, never a delta. */
export async function buildInventorySnapshot(socket: SupervisorCoreSocket): Promise<InventorySnapshot> {
  const [states, areas, devices, entities] = await Promise.all([
    getStates(),
    socket.listAreas(),
    socket.listDevices(),
    socket.listEntities(),
  ]);

  const stateByEntityId = new Map(states.map((s) => [s.entity_id, s]));

  // "service" devices are an integration/hub's own logical pseudo-device (an HA add-on's own
  // diagnostics device, an MQTT broker's own device, etc.) - never a physical device a technician
  // would want to see as a card. Drop them, and drop their entities too (rather than letting them
  // become "unassigned" noise), matching the old pull-based integration's own exclusion exactly.
  const serviceDeviceIds = new Set(devices.filter((d) => d.entry_type === "service").map((d) => d.id));
  const physicalDevices = devices.filter((d) => !serviceDeviceIds.has(d.id));
  const keptEntities = entities.filter((e) => !e.device_id || !serviceDeviceIds.has(e.device_id));

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
      return {
        ha_entity_id: e.entity_id,
        ha_device_id: e.device_id ?? undefined,
        ha_area_id: e.area_id ?? undefined,
        domain: e.entity_id.split(".")[0] ?? "unknown",
        friendly_name: typeof state?.attributes.friendly_name === "string" ? state.attributes.friendly_name : undefined,
        state: state?.state ?? null,
        attributes: state?.attributes ?? {},
        available: state ? state.state !== "unavailable" : false,
        entity_category: e.entity_category === "diagnostic" || e.entity_category === "config" ? e.entity_category : null,
      };
    }),
  };
}
