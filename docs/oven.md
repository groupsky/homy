# Kitchen oven

The kitchen oven is a Home Connect oven. A bridge outside this repo, hcpy
(`hc2mqtt`, https://github.com/hcpy2-0/hcpy), talks to it on the local network
and publishes it to Mosquitto under `homeconnect/oven/` (#1898).

## Topics

- `homeconnect/oven/state/<key>`: one retained topic per value, plain text
  (`Inactive`, `True`, `170`)
- `homeconnect/oven/event/<key>`: `{"event_type": "Present"}`, `Confirmed` or `Off`
- `homeconnect/oven/LWT`: `online` / `offline`
- commands: `homeconnect/oven/set`, `homeconnect/oven/activeProgram`,
  `homeconnect/oven/selectedProgram`. **Never publish a retained message to
  these**: the bridge would get it again at every restart.

Home Assistant gets the oven's entities from the bridge's MQTT discovery
(`sensor.oven_…`, `select.oven_…`, `number.oven_…`, `switch.oven_…`). This repo
has no integration for it.

## Logging

The `mqtt-influx-oven` bridge writes every state value and event to the `oven`
measurement in InfluxDB. Fields and queries: [InfluxDB schema](influxdb-schema.md#kitchen-oven).
The serial number, MAC and network data the bridge also publishes are not logged.

## The oven card (parents only)

The dashboard **Фурна** (`dashboard-oven`) is kept in
[`provision.json`](../config/home-assistant/provision.json); the deploy applies
it ([ha-provision](../scripts/ha-provision/README.md)). An edit in the UI is
replaced on the next run, so change the file instead.

It has one card with the status (state, door, power, temperature now, time
left, progress) and the controls from MQTT discovery: selected program,
temperature, duration, start (the active program), stop, light and the alarm
clock.

The card has a visibility condition "User" with the parents' Home Assistant
users, the same users as on the away-mode card
([away-mode](../docker/automations/docs/away-mode.md)). When a parent gets a
new account, add its user id there (Settings → People → Users shows the id in
the user's dialog).

**The condition only hides the card.** Any Home Assistant user can still
control the oven, from the entity pages, the search, Assist or the API. Anything
that can publish to Mosquitto can send the oven a command too. This was
chosen on purpose (#1898).

## Safety for tests

Never start a heating program or pyrolysis on the real oven in a test. A
command test may use only the oven light or the alarm clock.
