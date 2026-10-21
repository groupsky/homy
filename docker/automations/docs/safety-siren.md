# Safety siren

The bot `safetySiren` (type `safety-siren`, #1770) sounds the hall Zigbee siren
`floor1-alarm` (NEO NAS-AB02B0) for life-safety alerts. It works without the
internet, but not when routy or zigbee2mqtt is down. All numbers are in
`config/automations/config.js`.

## Alert table

The owner approved this table on 2026-10-16.

| Alert | Siren | Melody | Volume | Duration | In the bot |
|---|---|---|---|---|---|
| Smoke / fire | any hour | 14 Firetruck | high | 1800 s, repeat until stopped | no sensor yet |
| CO | any hour | 7 Red Alert | high | 1800 s, repeat until stopped | no sensor yet |
| Tank over 85 °C | day only (night later, after some weeks of data) | 6 High Pitch Siren | high | 60 s, up to 3 times | **yes**: `tank_overheat` |
| Water leak | day only | 11 Police | medium | 30 s | no sensor yet |
| Heat-pump freeze danger | day only | 16 Alarm Clock | medium | 30 s | no signal yet |

- **Tank over 85 °C** reads the tank top (SR-04 `t2`,
  `homy/features/sensor/temperature_boiler_high/status`, about one reading a
  second). It fires when every reading for 2 min is above 85 °C. It sounds
  60 s, then again after a 60 s pause, up to 3 times, while the value stays
  above 85 °C. The Grafana rule `boiler-controller-overheating` also sends a
  Telegram message for the same thing.
- **Day** is 07:00 to 23:00 in `Europe/Sofia`, the same hours as the Telegram
  quiet hours. An alert that starts at night sounds at 07:00 if it still holds.
- **Heat-pump freeze danger** has no usable signal yet. The heat pump's `s2`
  probe is not the outdoor air, and it was never under 12 °C in a year. The row
  is added when the owner picks a signal.

## Never for "no data"

An alert is confirmed only by a live reading that is still above the limit
when the confirm time has passed. The clock alone never confirms it. A null,
text or missing value is not a reading. A gap of more than 10 min (`maxAgeMs`)
starts the confirm time again, and it clears an active alert. The bot reads no
other alerts: a Telegram or Grafana alert never sounds the siren.

## Stop

- **A hall wall button**: `corridor1_kitchen_left` or `corridor1_kitchen_right`.
  It works only while a siren alert or the test sounds. At other times the
  bot ignores the buttons, so they keep working for the lights. A press always
  toggles that button's light too: no bot can keep a press from the light bots.
- **Home Assistant**: the button *Спри сирената* (`button.safety_siren_stop`,
  device Коридор 1).
- **The alert clears**: the value goes back to the limit or below it, or the
  readings stop.

A stopped alert does not sound again until it has cleared and comes back.

## Maintenance mute

The Home Assistant switch *Сирената без звук* (`switch.safety_siren_mute`)
blocks all alert sounds, and stops a sound that is playing. It turns itself off
after 2 h, and the time is kept over a restart. The test button still works
while it is on.

## Test

The Home Assistant button *Тест на сирената* (`button.safety_siren_test`)
sounds melody 6 at high volume for 30 s, at any hour. A hall wall button stops
it. Use it for the daytime test and for the loudness check at each pillow.

## Siren alive check

The bot sends one Telegram message when the siren has sent nothing for 3 h,
and one when it is back. zigbee2mqtt itself marks the siren offline only after
25 h. The age comes from the siren's own `last_seen`, not from when a message
arrives. After a zigbee2mqtt restart, zigbee2mqtt sends the old state again
with the old `last_seen`, and that is no sign of life. The siren normally
reports at least once an hour.

## The front-door bot

`frontDoorAlarm` (`door-alarm`) uses the same siren. On a door close it stops
the siren only when it sounded a step itself, so a door closing never silences
a safety alert. If the door bot sounds while a safety alert is active, its
sound replaces the safety sound until the next repeat.

## Commands

The bot sends `{"alarm": true, "melody": <n>, "volume": "<v>", "duration": <s>}`
and `{"alarm": false}` to `z2m/house1/floor1-alarm/set`, as plain JSON without
`_bot`/`_tz` (#1713).
