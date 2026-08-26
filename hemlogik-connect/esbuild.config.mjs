import { build } from "esbuild";
import { readFileSync } from "node:fs";

// The agent's self-reported version used to read process.env.npm_package_version, which is only
// ever set when npm itself launches the process - the actual container runs `node dist/index.js`
// directly (see ../Dockerfile), so that env var was never set and it silently fell back to a
// hardcoded "0.1.0" default forever, regardless of what was actually running (confirmed live:
// connectors.agent_version and the Diagnostics tab both showed "0.1.0" while running 0.3.0).
// config.yaml's `version` field is the one thing that's actually been bumped correctly every
// release (Supervisor requires it to notice updates at all), so it's the real source of truth -
// baked in at BUILD time via esbuild's `define`, not read at runtime.
const configYaml = readFileSync("config.yaml", "utf-8");
const versionMatch = configYaml.match(/^version:\s*"([^"]+)"/m);
if (!versionMatch) throw new Error("Could not read version: from config.yaml");
const agentVersion = versionMatch[1];

// Bundles the agent (plus its production deps, including the connect-protocol workspace package)
// into a single dist/index.js - the Docker image (../Dockerfile) only needs the Node runtime at
// image-build time, not a full npm toolchain, since this runs in CI before `docker build`.
//
// CommonJS output, deliberately - the image has no package.json next to dist/index.js (only the
// bundle itself is copied in, see ../Dockerfile), so there's nothing to tell Node to treat a
// plain .js file as an ES module; Node defaults bare .js to CommonJS, which then chokes on a
// top-level `import`. Nothing here needs true ESM (no top-level await), and CJS also sidesteps
// needing a createRequire() shim for ws's internal require() calls (which chokes with the exact
// "Cannot use import statement outside a module" error CJS output doesn't hit at all).
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: true,
  logLevel: "info",
  define: { __AGENT_VERSION__: JSON.stringify(agentVersion) },
});
