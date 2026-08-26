#!/usr/bin/with-contenv bashio
# Validates the App's own options against config.yaml's schema at container start (bashio does the
# actual schema validation before this even runs - this just logs what mode we're starting in, so
# a technician looking at the App's log immediately sees "not yet paired" vs "already paired"
# rather than having to guess from agent internals).

if bashio::fs.file_exists '/data/connector-credential.json'; then
  bashio::log.info "Hemlogik Connect: existing pairing found in /data - connecting as an already-enrolled device."
else
  if bashio::config.is_empty 'enrollment_key'; then
    bashio::log.info "Hemlogik Connect: not paired yet. Enter the connection key from the Hemlogik portal in this App's configuration."
  else
    bashio::log.info "Hemlogik Connect: not yet paired - will submit the configured connection key on startup."
  fi
fi
