# energy-report

Makes a monthly energy report from the meter counters (#1757). For each local month
(Europe/Sofia) it writes the kWh of the main meter and of each meter, with the day/night
split, the cost and the same month of last year, into the InfluxDB measurement
`energy_monthly`. On the 1st of each month it sends a short Telegram message with the
totals. It names the Grafana dashboard **Energy by month** (`energy-monthly`), with a
link only when `ENERGY_REPORT_DASHBOARD_URL` is set.

Tags and fields: [`energy_monthly` in the InfluxDB schema](../../docs/influxdb-schema.md#energy_monthly-measurement).
The tariff zones and the prices: [Energy dashboard](../../docs/energy-dashboard.md).

## When it runs

- **At start** it reads the months already in `energy_monthly`. It computes the missing
  months from 2023-11 to the last complete month, oldest first. The first start
  computes about 36 months; each month takes about 10 s of InfluxDB queries.
- **On the 1st of each month at 00:30 local** it computes the month before and sends
  the message. The 30 minutes let the last readings of the month arrive.
- **The message at start** is sent only when the start has just computed the previous
  month, and today is the 1st, 2nd or 3rd. So a deploy on the 21st sends nothing, and a
  restart on the 1st does not send the message twice.
- A failed InfluxDB query or write is logged and tried again after 15 minutes. A failed
  message is logged; it is not sent again. The service never exits because InfluxDB or
  telegram-bridge is away.

## How the numbers are made

The rules are the same as the backfill of the Home Assistant energy dashboard
(`scripts/energy-backfill`). `src/hourly.js` has copies of its functions, and a test
checks that both give the same results.

- **Only counter differences.** Never the integral of `current_power.p`, which was
  apparent power for three meters until #1749.
- For each meter, the last reading of each hour (`last()`, one query per meter for one
  month, with 7 days before and after it). The energy of an hour is its last reading
  minus the last reading of the hour before.
- **A step back** (a counter rollback) counts as no energy. Counting goes on from the
  lower value.
- **A step above 50 kWh in one hour** is a meter swap or a bad reading. It counts as no
  energy and is logged.
- **Missing hours**: the increase is spread evenly over them. A gap across the start or
  the end of a month is shared by both months.
- **Day or night** by the local start hour of each hour, with the EVN zones.
- **not_metered** = main minus the sum of the meters. It is the lights, sockets and
  everything else without its own meter.
- **Cost** = day kWh × day price + night kWh × night price, with the prices of the two
  grid sources in `config/home-assistant/energy.json`. Only for months from
  `ENERGY_REPORT_PRICES_FROM` on: older months had other prices, in BGN.
- **Last year**: the kWh of the same month one year before, as stored in
  `energy_monthly`, and the change in percent.
- **Point time**: each point is stamped with the time it is written, not with its
  month, so every write goes into the current InfluxDB shard and no old shard is
  rewritten. The month is the `month` tag. Readers find a month by its tag and take the
  newest point of each series (`ORDER BY time DESC LIMIT 1`), with no time range.

The meters are the physical meters of `scripts/energy-backfill/index.mjs` that count
from 2023-11: `MAIN` and `LOADS` in `src/report.js`. Left out on purpose:

- The report starts at **2023-11**, after the main meter was swapped on 2023-10-15/16.
- `kitchen` (no counter after 2025-09) and `waste_pump` (dead since 2026-06-25).
- The voltage stabiliser meter. It feeds the car charger, the borehole pump and the
  microwave, so it would count them twice.

## Configuration

The service talks only to `http://influxdb:8086` (database `homy`) and
`http://telegram-bridge:3000/webhook`, on the automation network. These are fixed in
`src/config.js` on purpose, as in `scripts/energy-backfill`: a request address taken from
the environment would be a request-forgery path (CodeQL).

| Variable | Meaning |
|---|---|
| `INFLUXDB_READ_USERNAME_FILE`, `INFLUXDB_READ_PASSWORD_FILE` | The read user, for the counters and the stored months. |
| `INFLUXDB_USERNAME_FILE`, `INFLUXDB_PASSWORD_FILE` | The write user. The service writes only `energy_monthly`. |
| `ENERGY_REPORT_DASHBOARD_URL` | Optional: a full link to the dashboard for the message, set only in the real `.env` (never a real domain in this repo). Not set: the message names the dashboard, with no link. Grafana has no public address, and the short name `grafana` does not open away from home. |
| `ENERGY_REPORT_PRICES_FROM` | The first month of the current prices. Default `2026-07`. Change it every July (below). |
| `ENERGY_REPORT_FIRST_MONTH` | The first month of the report. Default `2023-11`, and it cannot be earlier. |
| `ENERGY_REPORT_PRICES_FILE` | The prices file. Default `/config/energy.json`; compose mounts `energy.json` there read-only. |

Each `_FILE` variable can also be given directly, without `_FILE`. An empty variable
counts as not set.

## Every July

The new prices and `ENERGY_REPORT_PRICES_FROM` go live together on 1 July, after the
June report. The steps: "Change the prices every July" in
[the energy dashboard doc](../../docs/energy-dashboard.md#change-the-prices-every-july).

## Compute a month again

A month is computed again when its points are gone: at start the service takes the
months from the `month` tag, and computes only the ones that are missing. Drop all points
of the month with the write user, then restart the service.

```bash
docker exec -i homy-influxdb-1 sh <<'EOF'
export INFLUX_USERNAME=$(cat /run/secrets/influxdb_write_user)
export INFLUX_PASSWORD=$(cat /run/secrets/influxdb_write_user_password)
influx -database homy -execute "DROP SERIES FROM energy_monthly WHERE month = '2025-11'"
EOF
docker compose restart energy-report
docker compose logs --tail 20 energy-report
```

- A month before `ENERGY_REPORT_PRICES_FROM` gets no cost, so after a price change an
  older month loses its cost when it is computed again.
- The month one year later keeps its old "last year" values. Drop it too to update them.
- When the month is the previous month and today is the 1st to the 3rd, the restart
  sends its message again.

## Known limits

- A gap of more than 7 days across the start or the end of a month loses the energy of
  its hours in that month.
- The report runs at 00:30 on the 1st. A meter gap that is still open then, across the
  end of the month, cannot be spread yet: that energy is missing from the month.
- The message rounds each number on its own, so day + night can differ from the total
  by 1 kWh.

## Tests

```bash
npm test               # node:test, no dependencies to install
npm run test:coverage  # also writes coverage/lcov.info
```

The tests read `scripts/energy-backfill/` and `config/home-assistant/energy.json`, so run
them in a full checkout of the repository. CI: `.github/workflows/test-energy-report.yml`.
