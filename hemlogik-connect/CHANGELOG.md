# Changelog

## 0.6.0

- New option: **Sync devices, entities and automations** (`enable_device_sync`, on by default -
  nothing changes for an existing install). Turn it off to run this App as remote access only -
  the Cloudflare tunnel and connection to Hemlogik keep working exactly the same, but nothing about
  the home itself (devices, entities, automations, logs) ever leaves this device. Lets an
  installation be sold/onboarded as remote-access-only with a real, enforced boundary.
- Fixed a stuck-looking update: installing an update to this App itself (or anything else that
  restarts something mid-request) could never confirm its own completion back to the portal, since
  the request's responder is the process being replaced - the portal now finds out the update
  actually finished via an extra resync ~90 seconds after this App starts back up, on top of the
  existing "on connect + every 30 minutes" resync, plus a manual "Uppdatera nu" refresh button in
  the portal's Updates tab for checking immediately instead of waiting.

## 0.5.2

Two device-sync fixes reported live:
- A device's name could sync as a literal empty string instead of falling back to its manufacturer
  default or id - some integrations (Tuya's cloud integration in particular) leave HA's `name`
  field empty rather than null.
- Integration/hub pseudo-devices (an HA add-on's own diagnostics device, an MQTT broker's own
  device, etc. - HA's own `entry_type: "service"` marker) no longer sync as if they were physical
  devices, matching the old pull-based integration's exact exclusion. Diagnostic/config-category
  entities (battery %, link quality, RSSI) are now tagged so the portal can exclude them from a
  device's status badge without hiding them from its entity list - they were dragging otherwise-
  working devices into a constant "warning" state.

## 0.5.1

Fix: 0.5.0's AppArmor profile didn't grant the agent read access to `/etc/ssl/openssl.cnf` -
Node's OpenSSL 3.x provider config is read unconditionally at crypto-subsystem init (unrelated to
CA certificate verification, which uses Node's own bundled store and needed no filesystem access
at all). Denied, this crashed the agent on every single startup attempt
(`BIO_new_file:Permission denied`, exit code 13) while cloudflared - a separate process under its
own profile, with no OpenSSL config dependency - kept running, so the connector showed offline
while remote access stayed reachable. Confirmed live and fixed.

## 0.5.0

Adds a custom AppArmor profile (`apparmor.txt`) - sandboxes the container to exactly what it
needs to run (the agent's own code and `/data`, cloudflared's binary, both processes' network/DNS
needs) and nothing else, following Home Assistant's least-privilege guidance. No config.yaml
changes, no new permissions requested - this should bring the App's security rating to 6/6.

## 0.4.1

Fix: device names synced from HA's device registry only ever read the manufacturer/integration
default `name` field ("Sunricher HK-SL-DIM-A"), never `name_by_user` - the field HA's own frontend
actually prefers once a customer renames a device. Renamed devices now sync with their real name.

## 0.4.0

Broadens call_service control: cover (position slider via set_cover_position), fan (speed via
set_percentage, oscillate), media_player (select_source), plus two new domains - scene (turn_on)
and script (turn_on/turn_off). Powers the portal's richer per-domain device controls and the new
Scenes & Scripts tab. `lock` and `alarm_control_panel` remain permanently excluded.

## 0.3.1

Fix: the agent's self-reported version (shown in the portal's Diagnostics tab, and sent on every
enrollment/heartbeat) always read `process.env.npm_package_version`, which is only ever set when
npm itself launches a process - the container runs `node dist/index.js` directly, so that env var
was never set and it silently reported the hardcoded fallback "0.1.0" forever, no matter what was
actually installed. Now baked in at build time from config.yaml's `version` field instead (the one
value that's actually been kept correct every release, since Supervisor requires it to notice
updates at all).

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
