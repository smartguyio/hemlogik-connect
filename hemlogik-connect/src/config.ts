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
  /**
   * Remote-access-only mode when false - see config.yaml's enable_device_sync doc comment.
   * Defaults to true (bashio's own default plus this fallback both agree) so a container started
   * without the env var at all - e.g. `npm run dev`'s tsx watch, which never runs rootfs/etc/
   * services.d/agent/run - behaves like every existing install, not a fresh remote-access-only one.
   */
  get enableDeviceSync(): boolean {
    return process.env.ENABLE_DEVICE_SYNC !== "false";
  },
  get dataDir(): string {
    return process.env.DATA_DIR ?? "/data";
  },
  /**
   * Baked in at build time from config.yaml's version field (see esbuild.config.mjs) - NOT
   * process.env.npm_package_version, which is never set when the container runs `node
   * dist/index.js` directly (only npm itself sets it), so it silently reported "0.1.0" forever
   * regardless of what was actually running. __AGENT_VERSION__ is undefined outside an esbuild
   * bundle (e.g. `npm run dev`'s tsx watch), hence the fallback.
   */
  get agentVersion(): string {
    return typeof __AGENT_VERSION__ !== "undefined" ? __AGENT_VERSION__ : "0.0.0-dev";
  },
};
