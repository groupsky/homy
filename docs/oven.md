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
(`sensor.oven_bsh_…`, `select.oven_bsh_…`, `number.oven_…`, `switch.oven_…`).

## Bulgarian entities (#1907)

This repo adds its own MQTT entities for the same topics, in
`config/home-assistant/configuration/mqtt/` (`selects.yaml`, and the oven part
of `sensors.yaml` and `binary_sensors.yaml`):

- `select.oven_selected_program`, `select.oven_active_program` (selecting
  here **starts** the program)
- `sensor.oven_operation_state`, `sensor.oven_door_state`,
  `sensor.oven_power_state`, `sensor.oven_remaining_time`,
  `sensor.oven_program_progress`
- `binary_sensor.oven_local_control`, `binary_sensor.oven_remote_start_allowed`,
  and the events `binary_sensor.oven_preheat_finished`,
  `oven_fast_preheat_finished`, `oven_program_finished`, `oven_program_aborted`
  (ON while the oven shows the event)

**Why.** The bridge's discovery adds
`homeconnect/oven/state/bsh_common_status_localcontrolactive` as a third
availability topic to its controls. Each time someone opens the door or
touches the panel, `LocalControlActive` is `True` for 15-33 s and those
entities are `unavailable`, again and again in the history. The bridge has no
setting for this, and it cannot rename select options either. The entities
here depend only on `homeconnect/LWT` and `homeconnect/oven/LWT`, so they keep
their state. `binary_sensor.oven_local_control` shows the lock instead: while
it is ON, the oven does not take commands. The bridge's own entities are
left as they are; the card just does not show them.

**Where the names come from.** The program names and the `описание`
attribute of `select.oven_selected_program` are copied from Bosch's Bulgarian
manual for this oven: document 9001919872, bg-BG, HBG578EB7 (the heating-mode
table, the extra functions table and the programme table). The English
manual, same document, was used to match each name to its key. The manual
shortens some names (`Печ. слабо`, `Грил, гол. повърх.`,
`Говежд. задуш. на фурна`); they are kept as printed.

The oven offers 45 programs (checked on the broker, 2026-11-03). Keys with no
name in the manual stay as the raw key:

- `PorkNeckJoint`: the manual has only one pork neck program, and it is
  boneless (`BonelessPorkNeckJoint`, "Свински печен врат").
- `BottomHeating`, `LetRest`, `PreHeating`: not in the manual for this model.

Keys with no description in the manual (the attribute says
"Няма описание в ръководството"): the four above, and `PotatoGratin`,
`StewWithMeat`.

Two matches are by meaning, not by the same words: `SabbathProgramme` is
"Поддържане топло за по-дълъг период" (keep warm up to 70 hours), and
`SubsequentCooking` is "Допълнително готвене" (from the steps for setting a
program).

The manual has no labels for the operation, door and power states, so their
text is plain Bulgarian. A value with no Bulgarian text shows as the raw key.

**Commands.** The selects send the full key
(`Cooking.Oven.Program.HeatingMode.3DHotAir`), not the short one the bridge's
own selects send: the bridge finds a program by a substring match, so
`PorkNeckJoint` alone could pick `BonelessPorkNeckJoint`. Never retained.
The templates are tested in
`docker/modbus-serial/integrations/ha-oven-templates.test.js`.

## Logging

The `mqtt-influx-oven` bridge writes every state value and event to the `oven`
measurement in InfluxDB. Fields and queries: [InfluxDB schema](influxdb-schema.md#kitchen-oven).
The serial number, MAC and network data the bridge also publishes are not logged.

## The oven card (parents only)

The dashboard **Фурна** (`dashboard-oven`) is kept in
[`provision.json`](../config/home-assistant/provision.json); the deploy applies
it ([ha-provision](../scripts/ha-provision/README.md)). An edit in the UI is
replaced on the next run, so change the file instead.

It has one card with the status (state, door, power, the local-control lock,
remote start, temperature now, time left, progress, and the preheat, finished
and aborted events) and the controls: selected program with its description,
temperature, duration, start (the active program), stop, light and the alarm
clock. The state, program and event rows use the Bulgarian entities above;
temperature now, temperature, duration, stop, light and the alarm clock are
still the bridge's own entities.

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
