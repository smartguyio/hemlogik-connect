/**
 * All runtime config in one place, lazy-getter style (mirrors lib/config/env.ts's discipline in
 * the main Hemlogik Control repo) - never read process.env directly anywhere else in this agent.
 *
 * SUPERVISOR_BASE_URL/GATEWAY_URL default to the real production values but are overridable for
 * local development against the mock Supervisor (dev/mock-supervisor.ts) and a local `wrangler
 * dev` Gateway - the agent's own code never branches on "am I in dev", only these two base URLs
 * differ (AGENTS spec s49).
 */
export const config = {
  get supervisorToken(): string {
    const token = process.env.SUPERVISOR_TOKEN;
    if (!token) throw new Error("SUPERVISOR_TOKEN is not set - this only runs correctly inside Home Assistant's Supervisor (or against the local mock, which sets its own).");
    return token;
  },
  get supervisorBaseUrl(): string {
    return process.env.SUPERVISOR_BASE_URL ?? "http://supervisor";
  },
  get gatewayHttpUrl(): string {
    return process.env.CONNECT_GATEWAY_HTTP_URL ?? "https://connect.hemlogik.se";
  },
  get enrollmentKey(): string {
    return process.env.ENROLLMENT_KEY ?? "";
  },
  get dataDir(): string {
    return process.env.DATA_DIR ?? "/data";
  },
  get agentVersion(): string {
    return process.env.npm_package_version ?? "0.1.0";
  },
};
