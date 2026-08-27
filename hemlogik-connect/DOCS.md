# Hemlogik Connect

Hemlogik Connect connects this Home Assistant installation securely to Hemlogik for remote access,
monitoring, and management.

It does two things:

- **Hemlogik Remote** - gives you a private web address (`https://<random-id>.hemlogik.se`) that
  reaches this Home Assistant's normal login page from anywhere, with no port forwarding, no VPN,
  and no router configuration. One small one-time addition to Home Assistant's own
  `configuration.yaml` is still needed - see step 4 below.
- **Hemlogik Agent** - lets the Hemlogik portal know this installation is online, show its devices,
  and (for your installer, if you've asked them to help) make supported changes on your behalf.

Your Home Assistant username, password, and normal login process are completely unaffected -
Hemlogik Connect only adds a way to *reach* your Home Assistant, it never changes how you log into
it.

## Installation

1. Add this repository to your Home Assistant App/Add-on store, if it isn't already there.
2. Find **Hemlogik Connect** in the store and install it.
3. Start the App.
4. In Home Assistant: **Settings → System → Network**, scroll to the HTTP server section, turn on
   **Trust X-Forwarded-For**, and add `172.30.32.0/23` under **Trusted proxies** - this tells Home
   Assistant to trust requests arriving through your secure remote-access connection, without
   which it refuses them outright with a plain "400: Bad Request". (This used to be a
   `configuration.yaml` edit; Home Assistant moved it into this UI page - if you still have an old
   `http:` block with `trusted_proxies`/`use_x_forwarded_for` in `configuration.yaml`, remove it,
   it's now silently ignored.) Restart Home Assistant afterward.

## Configuration

Open the App's **Configuration** tab. There is one setting you need:

```yaml
enrollment_key: ""
```

Paste the connection key your Hemlogik installer gave you into `enrollment_key`, then save and
restart the App. The key is used exactly once to pair this Home Assistant with your Hemlogik
account - after that, you'll never need to enter it again (leaving an old key in this field does
nothing once pairing has succeeded).

```yaml
log_level: "info"
```

Leave this alone unless Hemlogik support asks you to change it for troubleshooting.

```yaml
enable_device_sync: true
```

On by default. Turn this off if you only want **remote access** through Hemlogik - your Cloudflare
tunnel and connection to Hemlogik keep working exactly the same, but nothing about your home
(devices, entities, automations, logs) is ever synced or visible in the Hemlogik portal. Ask your
Hemlogik installer if you're unsure which tier applies to you.

**You do not need to create a Home Assistant Long-Lived Access Token, configure Cloudflare
yourself, or edit any files** - the only extra step at all is the small Trusted proxies setting in
step 4 above, which every reverse-proxy-based remote access setup for Home Assistant requires
regardless of provider. If a setup guide asks for anything beyond that for Hemlogik Connect
specifically, something is wrong - contact Hemlogik support.

## Usage

After saving your connection key and starting the App, check the **Log** tab. You should see:

```
Hemlogik Connect agent starting...
Enrollment successful - paired with connector ...
Connected to Home Assistant Core via the Supervisor proxy
Connected to Hemlogik Cloud
```

Your Hemlogik installer or portal will then show this installation as connected, along with a
remote access URL. That URL becomes reachable within a minute or two of pairing.

## What Hemlogik Connect can and cannot do

- It can show your installation's online status, its areas/devices/entities, and their current
  state to authorized Hemlogik staff.
- It can turn on/off lights and switches, and adjust thermostats, **only** if a Hemlogik technician
  does so through the Hemlogik portal on your behalf - the App itself never acts on its own.
- It **cannot** control locks, alarms, or any device outside light/switch/climate through this
  mechanism.
- It does **not** access, store, or transmit camera feeds.
- It does **not** need or use a Home Assistant Long-Lived Access Token - it uses Home Assistant's
  own supported Supervisor connection instead.
- Your Supervisor token never leaves this Home Assistant installation.

## Security

Hemlogik Connect ships with its own AppArmor profile, which sandboxes the App's container to
exactly the files, processes, and permissions it actually needs to run - nothing more. This
follows Home Assistant's least-privilege guidance and is why the App shows a **6/6 security
rating** in Home Assistant's Add-on/App store.

## Troubleshooting

**"Not yet paired" keeps showing in the log.** Double check the connection key was pasted exactly
as given, with no extra spaces, and that the App was restarted after saving it. Connection keys
expire after 24 hours - ask your installer for a new one if it's been longer than that.

**The remote URL doesn't load.** This can take a minute or two right after pairing while your
secure tunnel is being set up. If it still doesn't work after that, check the App's log for errors,
or ask Hemlogik support to check the installation's diagnostics in the portal.

**The remote URL loads but shows a plain "400: Bad Request".** Home Assistant is rejecting the
connection because it doesn't trust it yet - check the Trusted proxies setting from step 4 of
Installation above (Settings → System → Network). This needs a full Home Assistant restart, not
just an App restart, to take effect. Note this is a UI setting, not a `configuration.yaml` edit -
if you have an old `http:` block with `trusted_proxies` in your YAML config, Home Assistant now
silently ignores it (with only a Repairs warning, not an error), which can make this look like
nothing you did had any effect.

**I want to disconnect a Home Assistant instance and connect a different one to the same Hemlogik
installation.** Ask your Hemlogik installer to issue a new connection key against the same
installation ("re-enroll") - your remote access URL stays the same.

## Support

This App is maintained by Hemlogik. For help, contact your Hemlogik installer or
[hej@hemlogik.se](mailto:hej@hemlogik.se).
