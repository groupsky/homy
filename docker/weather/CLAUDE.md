# weather

Records outdoor weather from [Open-Meteo](https://open-meteo.com/) into the InfluxDB
`weather` measurement, for analysis: the heating curve, heat-pump energy per degree of
cold, pre-heating with a forecast. The house has no outdoor sensor. These values are
model data for the grid cell of the house, not a measurement at the house.

Tags, fields and example queries: [`weather` in the InfluxDB schema](../../docs/influxdb-schema.md#weather-measurement).

## What it does

One poll every 15 minutes (2 minutes after each quarter hour):

- **current** values on every poll (`kind=current`). A missed poll is not filled in later,
  so a gap stays visible.
- the **forecast** for the next 48 hours, once per hour (`kind=forecast`), with the issue
  hour (`issued`) and the lead time (`lead_hours`), so forecast and actual can be compared.
- **history** for the last 14 days, once per UTC day (`kind=history`), from two named models:
  - `era5_seamless`: ERA5-Land temperature and humidity (about 11 km) with ERA5 cloud cover,
    rain, wind and sun (about 25 km). It is about 5 days behind.
  - `ecmwf_ifs`: about 9 km, no delay. It covers the days ERA5 does not have yet. Hours
    after the time of the call are left out, because they are still forecast.

- the **local estimates** once per hour: the solar collector at night (`source=collector`)
  and the docked mower battery (`source=mower`), both `kind=estimate`. See below.

A failed call or write is logged and tried again on the next poll. The service never
exits because Open-Meteo or InfluxDB is down.

## Setup (once)

The data go into their own retention policy `weather`, not `autogen`. `autogen` has
1-week shards. Writing history into an old, cold shard makes InfluxDB rewrite that whole
shard, and a backfill from 2020 would touch about 300 of them. With 520-week shards, all
weather data fit in two small shards. Create the policy once, before the first deploy, as
the InfluxDB admin:

```sql
CREATE RETENTION POLICY "weather" ON "homy" DURATION INF REPLICATION 1 SHARD DURATION 520w
```

The write and read users have rights on the whole database, so they need no change.
Queries name the policy: `FROM "weather"."weather"`.

## Configuration

| Variable | Meaning |
|---|---|
| `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` | House location. Set them only in the real `.env`; they are private and are never committed or logged. The service rounds them to 2 decimals (about 1 km) before use. |
| `INFLUXDB_URL`, `INFLUXDB_DATABASE`, `INFLUXDB_USERNAME_FILE`, `INFLUXDB_PASSWORD_FILE` | InfluxDB 1.x write user, as for the other writers. |
| `INFLUXDB_READ_USERNAME_FILE`, `INFLUXDB_READ_PASSWORD_FILE` | InfluxDB read user, for the solar controller and mower data of the local estimates. |
| `INFLUXDB_RP` | Retention policy, `weather` in compose. Without it the service writes to `autogen`, which is fine only for a test database. |

No API key is needed. The free service is for non-commercial use: 10,000 calls a day,
5,000 an hour, 600 a minute. A call for more than 2 weeks of data counts as several calls.
This service makes about 100 calls a day. The data are CC BY 4.0: show "Weather data by
Open-Meteo.com" next to any panel that shows them.

## History load (once)

The daily refresh covers only the last 14 days. Load older history once, inside the
running container, which has the location and the secrets:

```bash
docker exec homy-weather-1 node backfill.js 2020-12-01
# node backfill.js <start> [end, default today] [model, default era5_seamless]
```

It asks for one calendar year per call (about 26 weighted calls each). Writing the same
hour again overwrites it, so a failed run can simply be repeated.

## Collector night estimate (#1735)

The probe `t3` of the solar controller (InfluxDB `xymd1`, `device.name = solar_heater`) is
in the collector, outdoors. At night, with the solar pump (`outputs.p1`) off, it follows
the outdoor air. It needs no internet. Each UTC hour gets one point in `weather` with tags
`source=collector`, `kind=estimate`:

- `temperature`: the mean of `t3` from 30 minutes before to 30 minutes after the hour
  (the mean of four quarter-hour means), so it lines up with the Open-Meteo values, which
  are readings at the hour. It is written whenever all four quarters have data, also for
  invalid hours. All rules below use the same window.
- `valid` (boolean) and `reason` (string). The first rule that fails sets the reason:

| `reason` | Meaning |
|---|---|
| `no_data` | a quarter of the window has no reading |
| `unexplained_warm` | the nights of 2022-07-24 to 2022-09-16: 22 nights read 6–15 °C too warm, cause unknown |
| `probe_fault` | the nights of 2026-06-07 to 2026-08-09: the probe had fallen off |
| `day` | the sun is up during some part of the window |
| `after_sunset` | the window starts less than 3 hours after sunset; the collector still holds heat |
| `pump_on` | the solar pump ran during the window |
| `pump_unknown` | a quarter of the 60 minutes before the window has no reading, so the pump state is unknown |
| `pump_recent` | the solar pump ran in the 60 minutes before the window |
| `ok` | valid |

The rules are `RULES` and `KNOWN_BAD` in `src/collector.js`.

**Bias (decided in #1735: keep as is, no correction).** Against ECMWF IFS the collector reads
about −1.2 °C on clear nights (cloud cover under 20 %) and about 0 °C on cloudy nights (over
80 %), because under a clear sky it radiates heat to the sky. Over all nights it is −0.5 °C with
a night-to-night spread of 1.6 °C. For the air temperature, join on `cloud_cover` at the same
hour: offset ≈ −1.06 + 0.0122 × cloud %. It is one of three outdoor sources and can be dropped
later if an outdoor sensor or the Open-Meteo data make it redundant.

## Mower battery estimate (#1736)

`sunseeker-monitoring` stores the mower battery temperature (whole °C, about every 5 minutes)
in `sunseeker_battery_detail.temperature`, the mode in `sunseeker_mode.mode` and the dock state
in `sunseeker_station.at_station`. Docked and idle, the battery follows the air near the dock,
a few degrees warmer and about 2 hours late. Each UTC hour gets one point in `weather` with
tags `source=mower`, `kind=estimate`, the same fields and the same ±30-minute window as the
collector. The value is the raw battery temperature, not corrected. The data come through the
vendor cloud, so they stop when the internet is down.

| `reason` | Meaning |
|---|---|
| `no_data` | a quarter of the window has no battery reading |
| `stored` | inside a period in `STORED` (the mower is stored indoors) |
| `state_unknown` | no mode or dock message in the 10 hours before; they repeat every 3 to 7 hours while idle |
| `not_docked` | off the dock at some time in the window |
| `charging` | mode 3 (charging) in the window |
| `mowing` | any other mode than 0 (standby) in the window: mowing, going home, border, and the unnamed modes 4 and 5 |
| `gap_before` | a quarter of the 3 hours before the window has no battery reading; charging or mowing during a cloud outage would not be seen |
| `recent_activity` | not in standby on the dock for the whole 3 hours before the window |
| `ok` | valid |

The rules are `RULES` and `STORED` in `src/mower.js`. When the mower is put away for the
winter while it still reports from a dock, add `{from: '<ISO UTC time>', to: null}` to `STORED`,
and set `to` when it comes back.

**Bias (decided in #1736: keep the raw series, no correction).** Against ECMWF IFS the docked
battery reads +3.0 °C on average, with an hourly spread of 2.5 °C. It is about +4.2 °C at night
and +1.3 to +1.6 °C at midday, because the battery lags the air. It is about +5 °C in winter and
about 0 in August. A linear correction drifts with the season by about 1 °C, so none is stored.
It needs the internet (the vendor cloud), so it is **not an offline fallback**. It is the
lowest-priority of the three outdoor sources and the first to drop when an outdoor sensor or
the Open-Meteo data make it redundant.

**Building the past.** Once an hour the poller redoes the last 3 hours of both estimates, so
readings that reached InfluxDB late still count. On start it redoes the last 48 hours. Older
hours are built once:

```bash
docker exec homy-weather-1 node backfill-estimate.js collector 2022-07-20
docker exec homy-weather-1 node backfill-estimate.js mower 2025-08-26
# node backfill-estimate.js <collector|mower> <start> [end, default today]; 30 days per step, 5 s apart
```

## Rules for automations that read it

- Use it for analysis and to tune behaviour, for example pre-heating with a forecast.
- **No automation may depend on it for a decision in the moment.** The house must keep
  working without internet.
- A bot that reads it must treat old data as missing:
  - `current` older than 1 hour. The poller writes every 15 minutes.
  - a forecast whose `issued` is older than 3 hours.
- When the data are missing or old, a bot falls back in this order:
  1. the solar collector estimate at night (`source=collector`, valid hours only). The
     docked mower battery (`source=mower`) reads 1–5 °C warm and needs the internet, so it
     is not an offline fallback;
  2. the last value, held for up to 12 hours;
  3. a calendar average;
  4. its normal behaviour without weather data.
- Each bot that reads these data adds a row below and describes its fallback in its own doc.

| Automation | Reads | When the data are missing or old |
|---|---|---|
| none yet (2026-10-16) | | |

## Development

```bash
npm ci
npm test
```

The tests cover the request URLs, the conversion of answers into points, the poll
schedule and retries, the backfill, the config, and the InfluxDB writes (against a local
HTTP server). An end-to-end run against Open-Meteo and a throwaway InfluxDB:

```bash
docker network create wtest
docker run -d --name wtest-influx --network wtest -e INFLUXDB_DB=homy ghcr.io/groupsky/homy/influxdb:1.12.4-alpine
docker build -t homy-weather-test .
# 52.52/13.41 is the sample location from the Open-Meteo docs
docker run -d --name wtest-weather --network wtest -e WEATHER_LATITUDE=52.52 -e WEATHER_LONGITUDE=13.41 \
  -e INFLUXDB_URL=http://wtest-influx:8086 -e INFLUXDB_DATABASE=homy -e INFLUXDB_USERNAME=x -e INFLUXDB_PASSWORD=y homy-weather-test
docker exec wtest-influx influx -database homy -execute 'SELECT count(temperature) FROM weather GROUP BY kind, model'
docker rm -f wtest-weather wtest-influx && docker network rm wtest
```
