# Leaving-home check

The bot `leavingHomeCheck` (type `leaving-home-check`, #1955) sends one
Telegram message when the car leaves home on a workday morning and something
in the house is still on or open.

Example: "🚗 Колата тръгна. Вкъщи: светло: кухня; включено: котлон; отворено: прозорец баня 1."

## When it runs

- **Home** is the place that ev-journal publishes, retained, on
  `homy/ioniq/home` (`lat`, `lon`, `radius_m`). Without it the bot does
  nothing and logs it once.
- **Position**: `ioniq/parsed/gps`, real fixes only: `provider` is `gps`,
  `acc_m` is 50 or less, and `age_ms` is not set (a set `age_ms` is a repeat
  of an old fix).
- A fix inside `radius_m` sets the state to `home`. From `home`, the first fix
  more than `radius_m` + 200 m away is a departure. The check runs once.
  The car must come back inside the radius before the next check.
- The check runs only **Monday to Friday, 05:00–10:00** local time
  (`windowStart`, `windowEnd`, `timeZone` in the config). At other times a
  departure only changes the state. homy has no list of public holidays, so
  they are not skipped.

## What it checks

At the moment of leaving, from the last value of each input:

- the ceiling lights (`lights` in the config): status on;
- the oven: power above 1 W; the stove: power above 10 W (the same limits as
  `binary_sensor.oven` and `binary_sensor.stove` in Home Assistant). The oven
  uses only its power meter. The Home Connect state topics are plain text, and
  the automations service reads every message as JSON;
- the outside doors and windows (`contacts` in the config). Inside doors are
  not in the list.

A value older than 24 hours, or never seen, is listed as "неизвестно"
(unknown). Such values alone do not send a message.

## Settings

In `config/automations/config.js`, `bots.leavingHomeCheck`:

- `ignore`: names that are not checked, for example a light that an
  automation keeps on;
- `labels`: the Bulgarian name of each item in the message; an item without a
  label is shown by its feature name;
- `marginM` (200), `windowStart`, `windowEnd`, `maxValueAgeMs`.

The bot has the usual on/off switch in Home Assistant,
`switch.automation_leaving_home_check` (device "Проверка при тръгване"). It
sends `homy/automation/leavingHomeCheck/control`. It is on by default.

## Known limits

- While the switch is off, the bot gets no messages. If it is turned on again
  while the car is away, the next fix far from home counts as a departure,
  and the check uses the values from before the switch went off.
- The oven is checked by its power meter only: a reading taken while the
  heating element is off for a moment may show it as off.
