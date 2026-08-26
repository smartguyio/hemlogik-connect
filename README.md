# Hemlogik Connect

A Home Assistant add-on repository. Adding this repository to your Home Assistant instance makes
the **Hemlogik Connect** add-on available to install.

Hemlogik Connect connects your Home Assistant securely to Hemlogik for remote access, monitoring,
and management - no port forwarding, no VPN, no manual network configuration, and no Home
Assistant Long-Lived Access Token required.

## Installation

1. In Home Assistant: **Settings → Add-ons → Add-on Store → ⋮ (top right) → Repositories**.
2. Add `https://github.com/smartguyio/hemlogik-connect`.
3. Find **Hemlogik Connect** in the store and install it.
4. See [hemlogik-connect/DOCS.md](hemlogik-connect/DOCS.md) for configuration and usage.

## What's in this repository

This is a published mirror of the `ha-app/` folder from Hemlogik's main (private) application
repository, kept in sync automatically (see that repository's `.github/workflows/sync-ha-app.yml`).
It contains only the add-on itself - its Home Assistant manifest, container build files, and the
compiled agent - nothing from the wider Hemlogik platform.

Questions or issues: [hej@hemlogik.se](mailto:hej@hemlogik.se).
