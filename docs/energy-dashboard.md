# Energy dashboard

The Home Assistant Energy dashboard shows the grid import of the house, split
into the day and night tariff with their prices, and the energy of each metered
device.

## Where the setup lives

| File | What it holds |
|---|---|
| `config/home-assistant/energy.json` | The dashboard setup: grid sources, prices, device list. It is mounted read-only on `/config/.storage/energy`, so changes made in the Home Assistant UI are not saved. Change the file and deploy. |
| `config/home-assistant/configuration/utility_meters.yaml` | The counters that the dashboard reads. |
| `config/home-assistant/configuration/automations.yaml` | The automation `Grid tariff by zone`, which selects the day or night tariff. |
| `config/home-assistant/configuration/mqtt/sensors.yaml` | The raw meter sensors, read from MQTT. |

## Grid

- The source is the main meter's total import counter, `total_import_kwh` on
  `/modbus/main/main/reading`. Home Assistant reads it as
  `sensor.main_energy_sdm630_total_import_kwh_2023_11_11`. It is the meter's own
  total for all three phases, so do not add the phase counters as well.
- The utility meter `grid_import` splits it into `sensor.grid_import_day` and
  `sensor.grid_import_night`. Each one is a grid source with its own price.
- There is no export source. The house does not export: the main meter's export
  counter has not moved since 2025-03.
- There is no solar source. The PV feeds a separate grid connection, not the
  house. If it were listed, the dashboard would add the PV yield to the house
  consumption.

## Tariff zones

EVN, household, two-rate (day/night) meter. These are national rules in local
time (`Europe/Sofia`):

| Zone | Months | Hours |
|---|---|---|
| Night | 1 November to 31 March | 22:00–06:00 |
| Night | 1 April to 31 October | 23:00–07:00 |
| Day | the rest of the time | |

Sources: [FAQ of ERYUG, the local grid operator](https://www.elyug.bg/SpecialPages/ND_FAQ.aspx),
[measurement rules, Art. 25(2)](https://elyug.bg/getattachment/d3ee48c7-9cb7-4623-b211-8e5b5f231ced/rule_Izm_161013.aspx).

- The zones change on 1 April and 1 November, not on the clock-change days.
- The automation `Grid tariff by zone` runs at every full hour and when Home
  Assistant starts. It picks the zone from the month and the hour, so a missed
  switch is fixed within one hour.
- On 1 April and 1 November the new month's hours apply from midnight. So on
  1 November the night ends at 06:00, and on 1 April it ends at 07:00.
- **Not confirmed yet:** whether the utility's meter clock follows summer time.
  The setup assumes it follows the wall clock. To check it, look at the meter
  display at 07:30 or 23:30 on a summer-time day. If the meter stays on winter
  time all year, the summer edges are one hour later on the wall clock
  (00:00–08:00), and the automation must change.

## Prices

The prices are the two `number_energy_price` values in `energy.json`, in EUR
per kWh, with 20 % VAT. Home Assistant's currency is set to EUR in
`configuration.yaml`.

| Tariff | EUR/kWh with VAT | EUR/kWh without VAT |
|---|---|---|
| day | 0.15458 | 0.12882 |
| night | 0.09226 | 0.07688 |

- Valid 2026-07-01 to 2027-06-30. Read on 2026-10-15 from decision Ц-13 of KEVR,
  the national energy regulator
  ([decision](https://www.dker.bg/uploads/reshenia/2026/res-c-13-2026.pdf),
  pages 61–64) and the [EVN price table](https://www.evn.bg/Home/Electricity.aspx).
- These are all-in prices: energy plus the network part (transmission,
  distribution, access). The network part is the same day and night (0.04302
  with VAT). Only the energy part differs.
- There is no fixed monthly fee, so `cost_adjustment_day` is 0.

### Change the prices every July

KEVR sets new prices every year, usually from 1 July.

1. Find the new KEVR price decision on [dker.bg](https://www.dker.bg) and the
   new [EVN price table](https://www.evn.bg/Home/Electricity.aspx). Take the
   household two-rate (day/night) prices, all-in, with VAT.
2. Change the two `number_energy_price` values in
   `config/home-assistant/energy.json`. Update the table above, with the dates.
3. Open a PR, merge it and deploy. Home Assistant restarts and uses the new
   prices from then on. Past costs keep the old prices.

## Devices

The dashboard lists the counters `sensor.<device>_energy` from
`utility_meters.yaml`: water pump (the borehole pump), oven, stove, dishwasher,
laundry, boiler, heat pump, microwave and EV charger.

Not listed, on purpose:

- The voltage regulator output (`sensor.stabilizator_energy_used`). It feeds the
  EV charger, the borehole pump and the microwave, which are listed, so it
  would count them twice.
- The kitchen and waste pump meters. They are dead and switched off in the
  Modbus config.
- `sensor.heat_pump_energy_used`. It is the heat pump's old meter, with data
  until 2023-10-15.

## Why utility meters, and no negative values

- A meter's own counter can step back and stay lower. For example, the laundry
  meter went from 575.66 to 570.59 kWh on 2026-09-19 and counted on from there.
  Home Assistant statistics store such a step as negative energy. A utility
  meter ignores a step back and adds only the increases.
- `periodically_resetting: false` makes a device meter compare each value with
  the last good value. So it also counts the energy used while Home Assistant
  was restarting.
- `configuration.yaml` no longer sets `last_reset` on every sensor
  (`customize_glob`). The energy cost sensors start again from 0 at each Home
  Assistant restart. The forced `last_reset` hid this restart from the
  statistics, so each restart was stored as a negative cost.
- Known limit: the grid meter (with tariffs) does not count the energy used
  while Home Assistant was restarting. At start, Home Assistant forgets the last
  value of a meter with tariffs. A restart of a few minutes loses well under
  1 % of a day.
- Known limit: if a device meter once sends 0 by mistake and then its real
  value, its counter adds the full value once. This was not seen in the 10 days
  of states that Home Assistant keeps (checked on 2026-10-15). The grid sensor
  turns a missing or null value into "no value", not 0, so it is safe from
  this.

## History and the backfill

The counters above started on 2026-10-15 at 14:00 UTC (the deploy hour). The
hours before that come from the meter readings in InfluxDB, imported once by
[`scripts/energy-backfill`](../scripts/energy-backfill/index.mjs) (#1758):

- Each hour gets the increase of the meter's counter, from the last reading of
  the hour before to the last reading of the hour. A step back counts as no
  energy, like the utility meters. An increase above 50 kWh per hour is a
  meter swap or a bad reading, and counts as no energy; the script prints
  each one.
- When readings are missing for some hours, the increase is spread evenly over
  those hours. The longest gaps: 2025-09-05 to 09-10 (123 h, all meters) and
  2021-04-20 to 09-27 (laundry only).
- The main meter was swapped on 2023-10-15/16. Each meter is read on its own,
  so the swap is not counted as use. The 36 hours between the two meters'
  readings have no grid data.
- The grid's hours go to the day or the night tariff by the zone table above.
- Costs are imported only from 2026-07-01, at the current prices. Earlier
  prices were different and in BGN, so earlier hours have kWh but no cost.
- The imported sums start from 0. Home Assistant's live sums started again
  from 0 at the deploy, so the script also moves the live sums up
  (`recorder/adjust_sum_statistics`), so that they go on from the imported
  ones without a step. The size of the move is worked out from the meter
  readings, so a second run moves them by 0.

The old statistics of the raw sensors (for example `sensor.laundry_energy_used`
and `sensor.main_energy_sdm630_a_import_kwh_2023_11_11`) are not changed. The
dashboard does not read them.

### Run the backfill

It needs a long-lived access token of an **admin** user, in
`ha_provision_token` in the secrets directory (`SECRETS_PATH` in `.env`), the
same token as [ha-provision](../scripts/ha-provision/README.md). Every counter
must already have live statistics, that is, its meter must have counted some
energy since the deploy; the script refuses a counter that has none.

1. Copy the Home Assistant database first, with SQLite's online backup (Home
   Assistant keeps running):

   ```bash
   docker exec homy-ha-1 python3 -c "import sqlite3; d = sqlite3.connect('/config/home-assistant_v2.db.before-backfill'); sqlite3.connect('/config/home-assistant_v2.db').backup(d); d.close()"
   ```

2. Dry run. It prints, for each counter, the rows it would import and how much
   it would move the live sums:

   ```bash
   secrets=$(realpath "$(sed -n 's/^SECRETS_PATH=//p' .env)")
   docker run --rm --network homy_automation \
     -v "$PWD":/w:ro \
     -v "$secrets/ha_provision_token":/run/secrets/ha_provision_token:ro \
     -v "$secrets/influxdb_read_user":/run/secrets/influxdb_read_user:ro \
     -v "$secrets/influxdb_read_user_password":/run/secrets/influxdb_read_user_password:ro \
     ghcr.io/groupsky/homy/node:22.22.0-alpine3.23 \
     node /w/scripts/energy-backfill/index.mjs
   ```

3. The same command with `--apply` at the end imports the rows and moves the
   live sums.
4. A minute later, run the dry run again. Every counter must say `would adjust
   live sums by 0`: the live sums then go on from the imported ones.

Running it again imports the same rows over the old ones (Home Assistant
replaces a row with the same hour), so nothing is counted twice.

**To undo it**, put the copy back while Home Assistant is stopped. The
statistics and states recorded since the copy are lost.

```bash
docker compose stop ha
data=$(sed -n 's/^HOMEASSISTANT_DATA_PATH=//p' .env)
sudo mv "$data/home-assistant_v2.db" "$data/home-assistant_v2.db.after-backfill"
sudo rm -f "$data/home-assistant_v2.db-wal" "$data/home-assistant_v2.db-shm"
sudo cp -p "$data/home-assistant_v2.db.before-backfill" "$data/home-assistant_v2.db"
docker compose start ha
```

`stop` and `start` keep the same container; do not use `up` here.

## How to check it

- Grid kWh: the daily sum of `sensor.grid_import_day` and
  `sensor.grid_import_night` must match the change of `total_import_kwh` on
  `/modbus/main/main/reading` over the same local day.
- Cost: for a day, the dashboard cost must equal day kWh × day price + night
  kWh × night price.
