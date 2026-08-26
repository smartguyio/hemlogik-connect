# Changelog

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
