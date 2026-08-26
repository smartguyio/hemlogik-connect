# Changelog

## 0.3.0

Adds three commands for automation config editing: `get_automation_config`/`set_automation_config`
(HA's `/api/config/automation/config/{id}` REST endpoint, reached through Supervisor's proxy) and
`get_automation_traces` (HA's `trace/list` WebSocket command) - powers the portal's automation
YAML editor and run-history viewer for Connect-managed installations, matching what the old
pull-based integration already offered.

## 0.2.0

Adds a `get_logs` command: fetches Home Assistant's system log, pushed proactively every 30
minutes alongside the existing inventory resync so the portal's Logs page has a fresh cached
fallback even when nobody's watching. Broadens `call_service` control to `automation` (turn
on/off/trigger) and `update` (install/skip) domains, and to `cover`/`fan`/`media_player`, laying
the groundwork for retiring the portal's older, separate Home Assistant integration in favor of
Hemlogik Connect end to end.

## 0.1.2

Fix: bundle the agent as CommonJS instead of an ES module. The Docker image ships only
`dist/index.js`, with no `package.json` alongside it - Node defaults a bare `.js` file with no
"type": "module" in scope to CommonJS, so the previous ESM bundle's top-level `import` failed with
"Cannot use import statement outside a module" on every start.

## 0.1.1

Fix: add missing `init: false` - without it, Supervisor also injects Docker's own init process
alongside the App's s6-overlay, which s6-overlay v3 refuses to start under
("s6-overlay-suexec: fatal: can only run as pid 1"). The App would never start before this fix.

## 0.1.0

Initial release - enrollment via connection key, secure outbound connection to Hemlogik Cloud,
Cloudflare Tunnel-based remote access run locally by the App, area/device/entity inventory sync,
realtime state updates, and light/switch/climate control via the Hemlogik portal.
