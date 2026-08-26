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

  return {
    areas: areas.map((a) => ({ ha_area_id: a.area_id, name: a.name })),
    devices: devices.map((d) => ({
      ha_device_id: d.id,
      ha_area_id: d.area_id ?? undefined,
      // name_by_user (the customer's own rename, if any) wins over the manufacturer default -
      // see supervisor-client.ts's listDevices() comment.
      name: d.name_by_user ?? d.name ?? d.id,
      manufacturer: d.manufacturer ?? undefined,
      model: d.model ?? undefined,
    })),
    entities: entities.map((e) => {
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
      };
    }),
  };
}
