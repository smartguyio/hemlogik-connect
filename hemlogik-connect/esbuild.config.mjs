import { build } from "esbuild";

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
});
