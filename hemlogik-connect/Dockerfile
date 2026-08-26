# syntax=docker/dockerfile:1
ARG BUILD_FROM
FROM $BUILD_FROM

# HA App base images (ghcr.io/home-assistant/{arch}-base) are Alpine + s6-overlay + bashio -
# this is what /etc/services.d and the s6 supervision this App relies on (see rootfs/) come from.
# BUILD_ARCH is one of Home Assistant's own build-arg conventions (aarch64/amd64/armv7/...),
# automatically supplied by the Supervisor/CI build process per docs/apps/tutorial.
ARG BUILD_ARCH

# Node.js for the agent (see src/ - TypeScript, bundled to a single JS file, so only the Node
# runtime is needed in the final image, not npm/a package manager).
RUN apk add --no-cache nodejs

# cloudflared - the agent runs this as a supervised subprocess (rootfs/etc/services.d/cloudflared)
# once a tunnel token exists; no separate manually-installed container (AGENTS spec s25). Static
# binary per architecture, matching cloudflared's own release asset naming.
RUN set -eu; \
    case "${BUILD_ARCH}" in \
      aarch64) CF_ARCH="arm64" ;; \
      amd64)   CF_ARCH="amd64" ;; \
      armv7)   CF_ARCH="arm" ;; \
      *) echo "unsupported arch for cloudflared: ${BUILD_ARCH}" >&2; exit 1 ;; \
    esac; \
    wget -q -O /usr/bin/cloudflared "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"; \
    chmod +x /usr/bin/cloudflared

WORKDIR /app

# Agent bundle - a single esbuild-produced JS file with all dependencies (including the shared
# packages/connect-protocol workspace package) already inlined - see package.json/esbuild.config.mjs.
#
# This is intentionally COMMITTED to the repo (see ../../.gitignore's comment on this exact path)
# rather than built by CI: Home Assistant Supervisor's on-device build of a local/custom-repository
# App runs a plain `docker build` scoped to ONLY this folder - it cannot reach the sibling
# packages/connect-protocol/ elsewhere in this monorepo to bundle it itself, and there's no
# external CI pipeline (yet) to pre-build and publish an image. Run `npm run build` in this
# directory and re-commit dist/index.js whenever src/ or packages/connect-protocol/ changes. Once
# a real CI/registry pipeline exists, prefer that + config.yaml's `image:` field instead (faster
# installs, no build step on the customer's HA host) - see config.yaml's comment.
COPY dist/index.js ./dist/index.js

COPY rootfs /

RUN chmod a+x /etc/services.d/agent/run /etc/services.d/agent/finish \
              /etc/services.d/cloudflared/run /etc/services.d/cloudflared/finish \
              /etc/cont-init.d/*.sh

LABEL \
  io.hass.name="Hemlogik Connect" \
  io.hass.description="Connects Home Assistant securely to Hemlogik for remote access, monitoring and management." \
  io.hass.arch="${BUILD_ARCH}" \
  io.hass.type="addon"
