import { createServer } from "node:http";
import { WebSocketServer } from "ws";

/**
 * Minimal fake Supervisor Core proxy for local agent development (AGENTS spec s49) - serves just
 * enough of `/core/api/*` + `/core/websocket` for the agent to run its full loop against, with a
 * handful of fake light/switch/climate entities that change state on a timer. Point the agent at
 * this via SUPERVISOR_BASE_URL=http://localhost:8123 and SUPERVISOR_TOKEN=dev (any value - this
 * mock doesn't check it). Never used in production; not part of the Docker image.
 */
const PORT = 8123;
const TOKEN = "dev";

interface MockState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
}

const states = new Map<string, MockState>([
  ["light.kitchen", { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen light", brightness: 180 }, last_changed: now() }],
  ["light.living_room", { entity_id: "light.living_room", state: "off", attributes: { friendly_name: "Living room light" }, last_changed: now() }],
  ["switch.heater", { entity_id: "switch.heater", state: "off", attributes: { friendly_name: "Heater plug" }, last_changed: now() }],
  ["climate.thermostat", { entity_id: "climate.thermostat", state: "heat", attributes: { friendly_name: "Thermostat", current_temperature: 21.0, temperature: 22.0 }, last_changed: now() }],
]);

const areas = [{ area_id: "kitchen", name: "Kitchen" }, { area_id: "living_room", name: "Living room" }];
const devices = [
  { id: "dev_kitchen_light", area_id: "kitchen", name: "Kitchen light", manufacturer: "Mock", model: "Bulb" },
  { id: "dev_living_room_light", area_id: "living_room", name: "Living room light", manufacturer: "Mock", model: "Bulb" },
  { id: "dev_heater", area_id: "kitchen", name: "Heater", manufacturer: "Mock", model: "Plug" },
  { id: "dev_thermostat", area_id: "living_room", name: "Thermostat", manufacturer: "Mock", model: "Thermostat" },
];
const entityRegistry = [
  { entity_id: "light.kitchen", device_id: "dev_kitchen_light", area_id: null },
  { entity_id: "light.living_room", device_id: "dev_living_room_light", area_id: null },
  { entity_id: "switch.heater", device_id: "dev_heater", area_id: null },
  { entity_id: "climate.thermostat", device_id: "dev_thermostat", area_id: null },
];

function now(): string {
  return new Date().toISOString();
}

function requireAuth(authHeader: string | undefined): boolean {
  return authHeader === `Bearer ${TOKEN}`;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  res.setHeader("content-type", "application/json");

  if (!requireAuth(req.headers.authorization)) {
    res.writeHead(401);
    res.end(JSON.stringify({ error: "unauthorized" }));
    return;
  }

  if (url.pathname === "/core/api/config") {
    res.end(JSON.stringify({ version: "2026.8.0-mock", location_name: "Mock Home" }));
    return;
  }

  if (url.pathname === "/core/api/states") {
    res.end(JSON.stringify([...states.values()]));
    return;
  }

  const singleStateMatch = url.pathname.match(/^\/core\/api\/states\/(.+)$/);
  if (singleStateMatch) {
    const state = states.get(singleStateMatch[1]!);
    if (!state) {
      res.writeHead(404);
      res.end(JSON.stringify({ error: "not_found" }));
      return;
    }
    res.end(JSON.stringify(state));
    return;
  }

  const serviceMatch = url.pathname.match(/^\/core\/api\/services\/([^/]+)\/([^/]+)$/);
  if (serviceMatch && req.method === "POST") {
    const [, domain, service] = serviceMatch;
    const body = await readJsonBody(req);
    const entityId = body.entity_id as string;
    const state = states.get(entityId);
    if (state) {
      if (service === "turn_on") state.state = "on";
      if (service === "turn_off") state.state = "off";
      if (service === "toggle") state.state = state.state === "on" ? "off" : "on";
      if (domain === "climate" && typeof body.temperature === "number") state.attributes.temperature = body.temperature;
      state.last_changed = now();
      broadcastStateChanged(state);
    }
    res.end(JSON.stringify([]));
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "not_found" }));
});

function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => resolve(raw ? JSON.parse(raw) : {}));
  });
}

const wss = new WebSocketServer({ server, path: "/core/websocket" });
const sockets = new Set<import("ws").WebSocket>();

wss.on("connection", (ws) => {
  let authed = false;
  let nextEventId = 1;
  ws.send(JSON.stringify({ type: "auth_required" }));

  ws.on("message", (raw) => {
    const msg = JSON.parse(raw.toString());
    if (msg.type === "auth") {
      authed = msg.access_token === TOKEN;
      ws.send(JSON.stringify({ type: authed ? "auth_ok" : "auth_invalid" }));
      return;
    }
    if (!authed) return;

    if (msg.type === "config/area_registry/list") {
      ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: areas }));
    } else if (msg.type === "config/device_registry/list") {
      ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: devices }));
    } else if (msg.type === "config/entity_registry/list") {
      ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: entityRegistry }));
    } else if (msg.type === "subscribe_events") {
      (ws as unknown as { eventSubId: number }).eventSubId = msg.id;
      sockets.add(ws);
      ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: null }));
    } else {
      ws.send(JSON.stringify({ id: msg.id, type: "result", success: true, result: null }));
    }
    void nextEventId;
  });

  ws.on("close", () => sockets.delete(ws));
});

function broadcastStateChanged(state: MockState): void {
  for (const ws of sockets) {
    const subId = (ws as unknown as { eventSubId?: number }).eventSubId;
    if (!subId) continue;
    ws.send(
      JSON.stringify({
        id: subId,
        type: "event",
        event: { event_type: "state_changed", data: { entity_id: state.entity_id, new_state: state } },
      })
    );
  }
}

// Wiggle a light every 20s so there's something to see moving in the portal's realtime UI.
setInterval(() => {
  const kitchen = states.get("light.kitchen")!;
  kitchen.state = kitchen.state === "on" ? "off" : "on";
  kitchen.last_changed = now();
  broadcastStateChanged(kitchen);
}, 20_000);

server.listen(PORT, () => {
  console.log(`[mock-supervisor] listening on http://localhost:${PORT} (token: "${TOKEN}")`);
});
