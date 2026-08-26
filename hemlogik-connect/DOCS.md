# Hemlogik Connect

Hemlogik Connect connects this Home Assistant installation securely to Hemlogik for remote access,
monitoring, and management.

It does two things:

- **Hemlogik Remote** - gives you a private web address
  (`https://<random-id>.remote.hemlogik.se`) that reaches this Home Assistant's normal login page
  from anywhere, with no port forwarding, no VPN, and no manual network configuration.
- **Hemlogik Agent** - lets the Hemlogik portal know this installation is online, show its devices,
  and (for your installer, if you've asked them to help) make supported changes on your behalf.

Your Home Assistant username, password, and normal login process are completely unaffected -
Hemlogik Connect only adds a way to *reach* your Home Assistant, it never changes how you log into
it.

## Installation

1. Add this repository to your Home Assistant App/Add-on store, if it isn't already there.
2. Find **Hemlogik Connect** in the store and install it.
3. Start the App.

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

**You do not need to create a Home Assistant Long-Lived Access Token, configure Cloudflare, or
edit any files.** If a setup guide asks you to do any of that for Hemlogik Connect specifically,
something is wrong - contact Hemlogik support.

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

## Troubleshooting

**"Not yet paired" keeps showing in the log.** Double check the connection key was pasted exactly
as given, with no extra spaces, and that the App was restarted after saving it. Connection keys
expire after 24 hours - ask your installer for a new one if it's been longer than that.

**The remote URL doesn't load.** This can take a minute or two right after pairing while your
secure tunnel is being set up. If it still doesn't work after that, check the App's log for errors,
or ask Hemlogik support to check the installation's diagnostics in the portal.

**I want to disconnect a Home Assistant instance and connect a different one to the same Hemlogik
installation.** Ask your Hemlogik installer to issue a new connection key against the same
installation ("re-enroll") - your remote access URL stays the same.

## Support

This App is maintained by Hemlogik. For help, contact your Hemlogik installer or
[hej@hemlogik.se](mailto:hej@hemlogik.se).
