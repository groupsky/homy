# Ioniq `ioniq-cell-health` bot — Design Spec

Status: draft for review · Date: 2026-07-14 · Parent contract:
[`2026-07-14-ioniq-monitoring-phase3-design.md`](2026-07-14-ioniq-monitoring-phase3-design.md) §4.1
· Reference bot: [`docker/automations/bots/ioniq-dtc.js`](../../../docker/automations/bots/ioniq-dtc.js)

## 1. Purpose

Reduce two battery-health conditions that Grafana/InfluxQL express poorly (96-cell array math,
cross-frame merge) into trivial numeric derived signals the `mqtt-influx-ioniq` bridge writes to
InfluxDB, where Grafana alerts on them with a plain `classic_conditions` threshold:

- `derived/cell_spread_mv` — pack cell-voltage spread in millivolts at rest, plus the outlier cell index.
- `derived/module_temp_spread_c` — battery module temperature spread across all 12 modules, in °C.

## 2. Prod-verified data shapes (2026-07-14, read-only routy queries + live `mosquitto_sub`)

All five source topics confirmed live on prod and their field shapes verified against InfluxDB:

| Topic | Field | Shape | Cells/modules |
| --- | --- | --- | --- |
| `ioniq/parsed/cells/1` | `cells` | JSON string, 32 floats e.g. `"[3.64,3.64,…]"` | cells 1–32 |
| `ioniq/parsed/cells/33` | `cells` | JSON string, 32 floats | cells 33–64 |
| `ioniq/parsed/cells/65` | `cells` | JSON string, 32 floats | cells 65–96 |
| `ioniq/parsed/bms/2101` | `module_temps` | JSON string, 5 floats e.g. `"[30,30,30,30,30]"` | modules 1–5 |
| `ioniq/parsed/bms/2105` | `module_temps_6_12` | JSON string, 7 floats | modules 6–12 |

`state` tag values seen: `active`, `parked`, `charging`. Each payload also carries `state` and `ts`
fields (pass-through per §3 convention). The framework JSON-parses the MQTT payload, so the bot
receives a JS object whose `cells`/`module_temps`/`module_temps_6_12` values are **strings** that must
be `JSON.parse`d and guarded. (The `cells/1` prod sample confirmed the payload carries its own `state`
and `ts`.)

## 3. Behaviour

The bot follows the repo pattern `module.exports = (name, config) => ({ persistedCache, start })`,
exact-match topic subscriptions (config-overridable), and mocked-MQTT Jest tests.

### 3.1 `derived/cell_spread_mv`

- Reassemble the 96-cell array from the three `cells` segments (1→1-32, 33→33-64, 65→65-96). Each
  segment's last-known parsed array is held in `persistedCache` so a signal can be emitted whenever
  **any** of the three arrives while all three segments are present.
- On each incoming `cells/*` sample, update that segment, then if all three segments are present:
  compute `spread = (max − min) · 1000` mV over the 96 values; `outlierIndex` = the 1-based cell index
  whose value is furthest from the pack mean (`argmax |cell − mean|`, ties → lowest index).
- **Skip emission when `state === 'active'`** — this is a rest-spread signal; only emit for
  `parked`/`charging`. State/ts are taken from the triggering `cells/*` sample.
- Publish object: `{ _type:'ioniq', group:'derived/cell_spread_mv', state, ts, value:spread,
  outlierIndex }`.
- **Guards:** a segment that fails `JSON.parse`, is not an array, has the wrong length (≠ 32), or holds
  a non-finite value is rejected — the prior good segment is retained (not overwritten with garbage).
  If fewer than three good segments exist, no emission.

`bms/2101` is **not** a cell-spread source (only a module-temp source); cell frames carry their own
state/ts (verified in prod sample), so cell-spread is driven entirely by the `cells/*` frames.

### 3.2 `derived/module_temp_spread_c`

- Hold last-known parsed `module_temps` (5) and `module_temps_6_12` (7) in `persistedCache`.
- On each `bms/2101` or `bms/2105` sample, update that segment, then if both present: merge into 12
  module temps, compute `value = max − min` °C; publish `{ _type:'ioniq',
  group:'derived/module_temp_spread_c', state, ts, value }` using the triggering sample's state/ts. No
  active-skip (temperature spread matters at all states).
- **Guards:** same JSON/array/length (5 and 7)/finite guards; retain prior good segment on garbage; no
  emission until both present.

## 4. Config surface

```js
ioniqCellHealth: {
  type: 'ioniq-cell-health',
  cellTopics: ['ioniq/parsed/cells/1', 'ioniq/parsed/cells/33', 'ioniq/parsed/cells/65'],
  moduleTemp1Topic: 'ioniq/parsed/bms/2101',
  moduleTemp2Topic: 'ioniq/parsed/bms/2105',
  cellSpreadOutputTopic: 'ioniq/parsed/derived/cell_spread_mv',
  moduleTempSpreadOutputTopic: 'ioniq/parsed/derived/module_temp_spread_c',
}
```

All topics have in-code defaults matching the above; no new env vars or secrets.

## 5. Grafana rules — `config/grafana/provisioning/alerting/ioniq-cell-health-alerts.yaml`

Four rules (each warn/crit a separate rule), cloning the `ioniq-12v-alerts.yaml` shape:

| uid | signal | evaluator | severity | for |
| --- | --- | --- | --- | --- |
| `ioniq-cell-spread-warning` | `cell_spread_mv` | `gt 50` | warning | 10m |
| `ioniq-cell-spread-critical` | `cell_spread_mv` | `gt 100` | critical | 10m |
| `ioniq-module-temp-spread-warning` | `module_temp_spread_c` | `gt 8` | warning | 10m |
| `ioniq-module-temp-spread-critical` | `module_temp_spread_c` | `gt 15` | critical | 10m |

Each: `SELECT last("value") FROM "ioniq" WHERE "group"='derived/<name>' AND time >= now() - <window>`
(window 30m ≥ `for` 10m), datasource `P3C6603E967DC8568`, folder `Ioniq EV`, group `interval: 1m`,
`noDataState: OK`, `execErrState: Alerting`, full `__expr__` node model, `🚗` in title/summary, labels
`severity`/`device: ioniq`/`subsystem: battery`, static annotation text (`{{ $values.A.Value }}` for
the number only).

## 6. Deliverables

- `docker/automations/bots/ioniq-cell-health.js` + `.test.js`
- `config/automations/config.js` — `ioniqCellHealth` registered next to `ioniqDtc`
- `config/grafana/provisioning/alerting/ioniq-cell-health-alerts.yaml`
- `docs/influxdb-schema.md` — document `derived/cell_spread_mv` + `derived/module_temp_spread_c`

## 7. Test scenarios (TDD)

1. Subscribes to all five exact topics.
2. Full 96-cell reassembly from three segments → correct `value` (mV) and `outlierIndex`.
3. `state === 'active'` → cell-spread emission skipped; `parked`/`charging` → emitted.
4. Partial data: only 1 or 2 segments present → no cell-spread emission; third arrival triggers it.
5. Malformed/short/non-array/`NaN` segment → rejected, prior good segment retained, no bad emission.
6. Module temp merge (5 + 7 = 12) → `max − min`; no active-skip.
7. Module temp partial-data holding; malformed guard.
8. Payload shape: `_type:'ioniq'`, correct `group`, `state`/`ts` pass-through, numeric `value`.
9. Outlier index tie-break (lowest index) and 1-based indexing across segment boundaries.
</content>
