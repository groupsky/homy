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

A failed call or write is logged and tried again on the next poll. The service never
exits because Open-Meteo or InfluxDB is down.

## Configuration

| Variable | Meaning |
|---|---|
| `WEATHER_LATITUDE`, `WEATHER_LONGITUDE` | House location. Set them only in the real `.env`; they are private and are never committed or logged. The service rounds them to 2 decimals (about 1 km) before use. |
| `INFLUXDB_URL`, `INFLUXDB_DATABASE`, `INFLUXDB_USERNAME_FILE`, `INFLUXDB_PASSWORD_FILE` | InfluxDB 1.x write user, as for the other writers. |

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

## Rules for automations that read it

- Use it for analysis and to tune behaviour, for example pre-heating with a forecast.
- **No automation may depend on it for a decision in the moment.** The house must keep
  working without internet.
- A bot that reads it must treat old data as missing:
  - `current` older than 1 hour. The poller writes every 15 minutes.
  - a forecast whose `issued` is older than 3 hours.
- When the data are missing or old, a bot falls back in this order:
  1. the local estimate: the solar collector at night (#1735) and the mower battery while
     docked (#1736), once they exist;
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
