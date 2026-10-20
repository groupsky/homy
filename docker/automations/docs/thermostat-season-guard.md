# Thermostat season guard

The bot `thermostatSeasonGuard` (type `thermostat-season-guard`, #1739) sends a Telegram message when a room thermostat looks wrong for the season. It only warns. It never writes to a thermostat and never changes a setting.

It reads the `reading` topic of each room thermostat. The room list is the same as the clock sync uses. The room key is the last part of the topic.

## What is checked

| Check | Warns when | Months |
|---|---|---|
| `valveOpenLong` | Mode is `cooling` and the valve is open for more than 3 h without a break | October to April (local) |
| `lowCoolingTargetTemp` | Mode is `cooling` and the set point is under 15 °C. In cooling mode a low set point keeps the valve open. If the convectors have water, the borehole pump runs on | All year |
| `coolingInColdNights` | Mode is `cooling` and the last night was cold: lowest outdoor temperature under 8 °C | All year |

All numbers are in `config/automations/config.js`.

- A gap of more than 15 min between two readings of a room starts the open time again. The valve state in between is not known.
- The last night is the newest window from 22:00 to 07:00 local time with at least 12 outdoor values. It can be the night in progress.
- The time zone is `Europe/Sofia`.
- All decisions use the time of the reading (`_tz`), not the clock. So old messages can be replayed.

## One message per problem per day

One message for each room, check and local day. The list of sent messages is kept over a restart, so a restart does not send again. Old days are removed.

## Rooms that are kept in cooling mode on purpose

Set `THERMOSTAT_GUARD_SKIP` in the real `.env` on the host. It is not committed, because it says which room is kept cold on purpose.

Format: `room:check` pairs, separated by commas. Use one pair for each check.

```
THERMOSTAT_GUARD_SKIP=thermostat-x:coolingInColdNights,thermostat-x:lowCoolingTargetTemp
```

Then recreate the automations service so it reads the new value (a deploy does this when the compose file changes; otherwise `docker compose up -d automations`).

- Empty or missing: no exceptions.
- An unknown check name is ignored, and the bot logs an error at start.
- Whether a room with an exception also skips `valveOpenLong` is chosen with the pairs. In cooling mode, if a room gets warmer than its set point, the valve opens while the loop carries warm water. That heats the room. So list `valveOpenLong` only when you accept this.

## Outdoor data and the fallback

The cold night check reads `homy/weather/current` (see `docker/weather/CLAUDE.md`). The house must work without internet, so:

- A value that is more than 1 h old when it arrives is dropped.
- Values are kept for 36 h, once for each `time`, and over a restart.
- If the newest value is more than 12 h old, or no night has 12 values, the cold night check is skipped. The other two checks do not need outdoor data.
- The bot logs the switch between "have data" and "no data" once.

The collector estimate is not on MQTT, and monthly averages give no night minimum. So this is step 4 of the fallback list: normal behaviour without weather data.
