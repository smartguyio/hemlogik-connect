import { build } from "esbuild";

// Bundles the agent (plus its production deps, including the connect-protocol workspace package)
// into a single dist/index.js - the Docker image (../Dockerfile) only needs the Node runtime at
// image-build time, not a full npm toolchain, since this runs in CI before `docker build`.
await build({
  entryPoints: ["src/index.ts"],
  outfile: "dist/index.js",
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  sourcemap: true,
  logLevel: "info",
});
