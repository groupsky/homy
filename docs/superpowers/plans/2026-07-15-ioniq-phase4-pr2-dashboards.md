# Ioniq EV Phase-4 PR2 — Four Detail Dashboards Build Plan

> **For agentic workers:** clone the LOCKED PR1 template
> `config/grafana/dashboards/Ioniq EV/ioniq-overview.json` verbatim for every shared block, then
> replace only `description`, `panels`, `time.from`, `title`, `uid`. Validate against the same local
> Grafana 9.5.21 + read-only prod-InfluxDB tunnel harness PR1 used (build brief §6). Do **not**
> re-litigate the template or the verified facts in the spec / build brief.

**Goal:** Deliver the four remaining Phase-4 dashboards — `ioniq-battery`, `ioniq-12v-ldc`,
`ioniq-tires`, `ioniq-pipeline` — each at `config/grafana/dashboards/Ioniq EV/<uid>.json`, cloning
PR1's canonical shape.

**Ground truth (do not contradict without loud evidence):**
- Spec §3.2–§3.5: `docs/superpowers/specs/2026-07-15-ioniq-monitoring-phase4-dashboards-design.md`
- Verified build brief: `docs/superpowers/plans/2026-07-15-ioniq-phase4-dashboards-build-brief.md`
- LOCKED template + idiom: `config/grafana/dashboards/Ioniq EV/ioniq-overview.json` and the PR1 plan
  `docs/superpowers/plans/2026-07-15-ioniq-overview-dashboard.md`
- Panel-type precedents (timeseries / bargauge / table / heatmap): `sunseeker-battery.json`,
  `sunseeker-overview.json`.

---

## 0. Global constraints (inherited from PR1 — apply to all four dashboards)

These are verified ground truth. Every panel and query obeys them.

- **InfluxDB v1 / InfluxQL only.** Never Flux, never SQL. Datasource UID `P3C6603E967DC8568`,
  db `homy`, measurement `ioniq`.
- **Datasource reference is always object form** — `{"type":"influxdb","uid":"P3C6603E967DC8568"}` —
  at panel level *and* inside every `targets[]` entry. Never a bare string.
- **Target style = "Style A"**: `datasource` + `query` (raw InfluxQL) + `rawQuery: true` + `refId`.
  Never `heatpump.json`'s builder-style `select`/`groupBy`/`tags`/`measurement` metadata.
- **Quoting (build brief §4.1 TRAPS — non-negotiable):**
  - `"group"` is a reserved word → **always double-quoted**.
  - Dotted fields are one whole quoted identifier: `"fl.psi"`, `"fl.c"` — never `fl."psi"`, never bare.
  - Tag string values single-quoted: `'tpms'`, `'bms/2101'`, `'parked'`, `'active'`.
- **`km` is overloaded** (`odometer`.km ≈ 174650 vs `range_est`.km ≈ 145.6). **Every `km` query MUST
  filter `"group"`.**
- **`state` is BOTH a tag and a field.** Band by the *tag*: `GROUP BY "state"`. Never rely on a bare
  `SELECT "state"`.
- **Liveness = `last()` + timestamp, never `count()`.** `last()` reports the sample's *age*; `count()`
  reports only presence. Both return no row over a fully empty window, so **last-seen panels use a fixed
  wide lookback (`time > now() - 30d`), not `$timeFilter`** — otherwise they read "No data" the moment
  the car sleeps past the dashboard range. (This mirrors the overview Last-Seen panel exactly.)
  `count()`-per-`time(1m)` **is** allowed on the pipeline samples/min panel — that is an intentional
  rate over the awake window, not a liveness check.
- **Series display names use the target `alias` field, never `byName` overrides on an InfluxQL column.**
  The 9.5.21 InfluxQL frontend parser names each series `<measurement>.<column>` unless the column is
  literally `value`, so a `byName:"soc"` override silently never matches. Set `alias` on the target.
  When a panel *does* need per-series axis/color overrides, the `byName` matcher must match the **alias
  string** (alias sets the frame name). For `GROUP BY "state"` series, use alias pattern `$tag_state`.
  Do **not** copy `sunseeker-overview.json`'s `byName:"battery"` override — it is dead code by this rule.
- **Sparsity-aware querying + descriptions.** Where a signal is legitimately flat, pinned, frozen, or
  sparse, the panel `description` must say so, so a reviewer never reads healthy data as "no data".
  Specifically flag: `derived/cell_spread_mv` (4 points all-time, rest-only), tire `derived/*`
  (driving-gated), `state='parked'` (~0.6%) / `state='charging'` (~1.3%), and pinned
  `isolation_kohm`~1000 / `avail_chg`/`avail_dis`~98.
- **`cell_spread_mv` can spike to an impossible ~3800 mV** (all-zeros cell frame). Set a fixed axis max
  and thresholds that tolerate the spike — do NOT auto-scale to it.
- **Forbidden keys** (do not leak in): `minVizWidth`, `minVizHeight`, `sizing` (post-9.5.21);
  `percentunit` where a 0–100 value needs `percent`; `folderId`/legacy `inactive` (alertlist only, N/A
  here). Odometer/range unit must be `"suffix: km"`, never `lengthkm` (SI-rescales to "Mm").
- **Top-level key order** (alphabetical, exactly as PR1): `annotations, description, editable,
  fiscalYearStartMonth, graphTooltip, id, links, liveNow, panels, refresh, schemaVersion, style, tags,
  templating, time, timepicker, timezone, title, uid, version, weekStart`.
- **Fixed template values:** `id: null`, `editable: true`, `style: "dark"`, `schemaVersion: 37`,
  `templating: {"list": []}`, `liveNow: false`, `graphTooltip: 0`, `fiscalYearStartMonth: 0`,
  `version: 1`, `weekStart: ""`, `timezone: ""`, `timepicker: {}`, `pluginVersion: "9.5.2"` per panel.
- **Git:** selective staging only (never `git add .`); every commit body ends with the Claude-Session
  trailer. Prod is read-only (SELECT/SHOW only); never deploy the branch to prod Grafana.

### Shared template blocks (clone verbatim from `ioniq-overview.json` into all four files)

1. **`annotations.list`** — the builtIn "Annotations & Alerts" block (overview lines 2–23).
2. **`links`** — the single tag-based nav row: `type: "dashboards"`, `asDropdown: true`,
   `tags: ["ioniq"]`, `keepTime: true`, `title: "Ioniq EV"`, `tooltip: "Other Ioniq EV dashboards"`
   (overview lines 29–44). Identical in every file — the nav auto-populates the family.
3. **`templating`** — `{"list": []}`.
4. **`tags`** — `["ioniq","ev","vehicle"]`.
5. **Datasource object form** on panel + every target.

### Per-file overrides vs overview

| Key | Overview (PR1) | These four (PR2 detail) |
|---|---|---|
| `time.from` | `now-24h` | **`now-6h`** |
| `refresh` | `1m` | `1m` (unchanged) |
| `title` / `uid` / `description` / `panels` | overview | per dashboard below |

### Threshold numbers — mirror the shipped alert rules (do not invent)

Read from `config/grafana/provisioning/alerting/ioniq-*.yaml` (verified 2026-07-15):

| Signal | Rule | Grafana steps (ascending lower bounds) |
|---|---|---|
| `aux_12v` (parked) | low `<12.2`, crit `<11.8` | `red(null) → orange(11.8) → green(12.2)` |
| `isolation_kohm` | warn `<500`, crit `<100` | `red(null) → orange(100) → green(500)` |
| `cell_min_v` | low `<3.0`, crit `<2.5` | `red(null) → orange(2.5) → green(3.0)` |
| `cell_max_v` | crit `>4.15` | `green(null) → red(4.15)` |
| `temp_max` | high `>45`, crit `>55` | `green(null) → orange(45) → red(55)` |
| `soh` | reduced `<98`, crit `<85` | `red(null) → orange(85) → green(98)` |
| `avail_dis` | derated `<70` (soc>30) | `red(null) → green(70)` |
| `cell_spread_mv` | warn `>50`, crit `>100` | `green(null) → orange(50) → red(100)` |
| `module_temp_spread_c` | warn `>8`, crit `>15` | `green(null) → orange(8) → red(15)` |
| `tire_*_psi_cold` | low `<30`, crit `<26`, over `>42` | `red(null) → orange(26) → green(30) → red(42)` |
| `tire_*_temp_excess` | hot `>8` | `green(null) → red(8)` |
| `ldc_ok` | alert `<1` | value-map `0→"Not charging"(red)`, `1→"OK"(green)` |
| `aux12v_drop` | alert `>0` | `green(null) → red(0.1)` (see note in §2 P8) |
| `dtc_count` | `>0` | `green(null) → red(1)` |

---

## 1. Dashboard: `ioniq-battery`

- **uid:** `ioniq-battery` · **title:** `🚗 Ioniq EV – Battery health` (en dash U+2013, matching spec)
- **tags:** `["ioniq","ev","vehicle"]` · **time:** `now-6h` · **refresh:** `1m` ·
  **schemaVersion:** 37 · **datasource:** object form, UID `P3C6603E967DC8568`
- Reuses all shared-template blocks (annotations, tag-nav links row, `templating:{list:[]}`,
  datasource object form) verbatim from the overview.
- **9 panels.** Spec §3.2 rows are mapped; the two ⚠️ v1 substitutions (no per-module heatmap →
  temp_max/min + module_temp_spread; approximate windowed efficiency, not lifetime) are honored.

### gridPos layout (24-col)

| id | panel | type | x | y | w | h |
|---|---|---|---|---|---|---|
| 1 | SoC & SoH trend | timeseries | 0 | 0 | 12 | 8 |
| 2 | Cell Voltages (max/min) | timeseries | 12 | 0 | 12 | 8 |
| 3 | Cell Voltage Spread | timeseries | 0 | 8 | 12 | 8 |
| 4 | Pack Temperature (max/min) | timeseries | 12 | 8 | 12 | 8 |
| 5 | Module Temperature Spread | timeseries | 0 | 16 | 12 | 8 |
| 6 | HV Isolation Resistance | timeseries | 12 | 16 | 12 | 8 |
| 7 | Charge / Discharge Envelope | timeseries | 0 | 24 | 12 | 8 |
| 8 | Cumulative Counters | table | 12 | 24 | 12 | 8 |
| 9 | Windowed Throughput & Approx Round-trip Efficiency | table | 0 | 32 | 24 | 6 |

Every row fills 24/24 with no overlaps.

### Panel details

**Panel 1 — SoC & SoH trend (timeseries)**
- Targets (Style A, `alias` sets series name):
  - A: `SELECT mean("soc") AS "soc" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `SoC (pack)`
  - B: `SELECT mean("soh") AS "soh" FROM "ioniq" WHERE "group"='bms/2105' AND $timeFilter GROUP BY time($__interval) fill(previous)` · alias `SoH`
- fieldConfig: `unit: "percent"`, `min: 0`, `max: 100`, `decimals: 0`, `color.mode: "palette-classic"`,
  custom `drawStyle:"line"`, `fillOpacity:10`, `showPoints:"never"`, `spanNulls:false`.
- options: `legend {displayMode:"list", placement:"bottom", showLegend:true, calcs:[]}`,
  `tooltip {mode:"multi", sort:"none"}`.
- description: `Traction-battery state of charge (pack SoC, bms/2101) and state of health (bms/2105 soh). SoH updates infrequently (~daily; its alert evaluates a 24 h window) so over a 6 h range it reads as a single flat step carried forward with fill(previous) — that is expected, not stale. SoH ~100 is healthy; the shipped alerts fire below 98 (reduced) and 85 (critical).`

**Panel 2 — Cell Voltages max/min (timeseries)**
- Targets:
  - A: `SELECT mean("cell_max_v") AS "cell_max_v" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Cell max`
  - B: `SELECT mean("cell_min_v") AS "cell_min_v" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Cell min`
- fieldConfig: `unit: "volt"`, `decimals: 3`, `color.mode:"palette-classic"`, thresholds
  `red(null) → orange(2.5) → green(3.0)` with `thresholdsStyle.mode:"off"` (bands documented, not drawn),
  custom line/area as P1.
- options: legend bottom multi, tooltip multi.
- description: `Highest and lowest single-cell voltages in the pack (bms/2101 cell_max_v / cell_min_v). Healthy at rest ~3.6-3.7 V and nearly equal. Shipped alerts: min-cell low <3.0 V / critical <2.5 V, max-cell critical >4.15 V. A widening gap between the two lines is the early cell-imbalance signal.`

**Panel 3 — Cell Voltage Spread (timeseries)** — SPARSE (rest-only, 4 points all-time)
- Target: `SELECT last("value") AS "cell_spread_mv" FROM "ioniq" WHERE "group"='derived/cell_spread_mv' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Cell spread`
- fieldConfig: `unit: "mvolt"`, `decimals: 0`, `min: 0`, **`max: 150`** (fixed — tolerate the impossible
  ~3800 mV spike by letting it clip off-scale, NOT auto-scaling), thresholds
  `green(null) → orange(50) → red(100)`, `thresholdsStyle.mode:"line"`, custom `showPoints:"always"`,
  `pointSize:6`, `spanNulls:true`, `drawStyle:"line"`.
- options: legend bottom list, tooltip single.
- description: `Max-minus-min cell voltage at rest (derived/cell_spread_mv). GENUINELY SPARSE: emitted only when the car is at rest (state charging/parked) — historically only a handful of points all-time — so over a 6 h daytime window this panel is often EMPTY. That is expected, not a broken feed; widen the range to a rest window to see points. Axis is pinned to 0-150 mV: a known bot edge case can emit an impossible ~3800 mV when a cell frame arrives all-zeros, and this panel deliberately does NOT auto-scale to that spike (it clips off-scale instead). Alerts: warning >50 mV, critical >100 mV.`

**Panel 4 — Pack Temperature max/min (timeseries)** (⚠️ v1 substitute for the per-module heatmap)
- Targets:
  - A: `SELECT mean("temp_max") AS "temp_max" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Pack max`
  - B: `SELECT mean("temp_min") AS "temp_min" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Pack min`
- fieldConfig: `unit: "celsius"`, `decimals: 0`, `color.mode:"palette-classic"`, thresholds
  `green(null) → orange(45) → red(55)`, `thresholdsStyle.mode:"off"`.
- options: legend bottom multi, tooltip multi.
- description: `Pack temperature envelope (bms/2101 temp_max / temp_min). v1 substitute for a full 12-module heatmap, which is not buildable in InfluxQL because module_temps is a JSON-string field (needs a future array-explosion bot). Shipped alerts: temp_max high >45 °C, critical >55 °C. Inter-module spread is shown separately in the next panel.`

**Panel 5 — Module Temperature Spread (timeseries)**
- Target: `SELECT last("value") AS "module_temp_spread_c" FROM "ioniq" WHERE "group"='derived/module_temp_spread_c' AND $timeFilter GROUP BY time($__interval) fill(previous)` · alias `Module spread`
- fieldConfig: `unit: "celsius"`, `decimals: 1`, `min: 0`, thresholds `green(null) → orange(8) → red(15)`,
  `thresholdsStyle.mode:"line"`, custom line/area.
- options: legend bottom list, tooltip single.
- description: `Spread between the hottest and coldest battery module (derived/module_temp_spread_c). Dense — emitted with every bms/2101 sample. Healthy near 0; a rising spread flags uneven module cooling. Alerts: warning >8 °C, critical >15 °C.`

**Panel 6 — HV Isolation Resistance (timeseries)** — PINNED ~1000 (healthy)
- Target: `SELECT mean("isolation_kohm") AS "isolation_kohm" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Isolation`
- fieldConfig: `unit: "suffix: kΩ"`, `decimals: 0`, thresholds `red(null) → orange(100) → green(500)`,
  `thresholdsStyle.mode:"off"`.
- options: legend bottom list, tooltip single.
- description: `High-voltage isolation resistance (bms/2101 isolation_kohm). Pinned at ~1000 kΩ, the healthy sensor ceiling — a FLAT line at ~1000 is exactly correct and does NOT mean "no data". Only a drop matters: alerts fire below 500 kΩ (warning) and 100 kΩ (critical), which would indicate HV insulation breakdown.`

**Panel 7 — Charge / Discharge Envelope (timeseries)** — PINNED ~98 (healthy)
- Targets:
  - A: `SELECT mean("avail_chg") AS "avail_chg" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Avail charge`
  - B: `SELECT mean("avail_dis") AS "avail_dis" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Avail discharge`
- fieldConfig: `unit: "percent"`, `min: 0`, `max: 100`, `decimals: 0`, `color.mode:"palette-classic"`,
  thresholds `red(null) → green(70)`, `thresholdsStyle.mode:"off"`.
- options: legend bottom multi, tooltip multi.
- description: `BMS-permitted charge/discharge power envelope as a percentage (bms/2101 avail_chg / avail_dis). Pinned near 98 %, mostly FLAT = healthy full capability (not "no data"). The available-discharge alert derates below 70 % while SoC > 30 %; a sustained drop means the BMS is limiting power (cold pack, low SoC, or a fault).`

**Panel 8 — Cumulative Counters (table)**
- Target: `SELECT last("cum_chg_ah") AS "Charge (Ah)", last("cum_dis_ah") AS "Discharge (Ah)", last("cum_in_kwh") AS "Energy In (kWh)", last("cum_out_kwh") AS "Energy Out (kWh)" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter`
- fieldConfig: table `custom {align:"auto", displayMode:"list", inspect:false}`; per-column `overrides`
  by `byName` on the aliases setting `unit`: Ah columns `"suffix: Ah"` decimals 1, kWh columns
  `"kwatth"` decimals 1.
- options: `{showHeader: true}`.
- description: `Lifetime cumulative energy counters (bms/2101). NOTE: these counters appear to have been reset at some point (they do not span full vehicle life), so treat them as running totals since the last reset, not odometer-style lifetime figures. Use the windowed panel below for a rate you can trust.`

**Panel 9 — Windowed Throughput & Approx Round-trip Efficiency (table)** (⚠️ v1 approximate)
- Target: `SELECT spread("cum_in_kwh") AS "Energy In (window kWh)", spread("cum_out_kwh") AS "Energy Out (window kWh)", spread("cum_chg_ah") AS "Charge (window Ah)", spread("cum_dis_ah") AS "Discharge (window Ah)", (spread("cum_out_kwh") / spread("cum_in_kwh")) * 100 AS "Approx round-trip eff (%)" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter`
  - `spread()` on a monotonic counter = last − first = the window delta.
- fieldConfig: table; `overrides` by alias: kWh columns `"kwatth"` decimals 2, Ah columns `"suffix: Ah"`
  decimals 1, efficiency column `unit:"percent"` decimals 1.
- options: `{showHeader: true}`.
- description: `Energy/charge moved during the selected time range (delta of each cumulative counter via spread()), plus an APPROXIMATE windowed round-trip efficiency (energy out / energy in). This is a windowed estimate, NOT a lifetime figure. It is only meaningful over a window that contains both charging and discharging; over a drive-only window Energy In ≈ 0 and the ratio is meaningless (blank or absurd). Widen to a window spanning a charge session before reading the efficiency.`

---

## 2. Dashboard: `ioniq-12v-ldc`

- **uid:** `ioniq-12v-ldc` · **title:** `🚗 Ioniq EV – 12 V / LDC`
- **tags:** `["ioniq","ev","vehicle"]` · **time:** `now-6h` · **refresh:** `1m` · schemaVersion 37 ·
  datasource object form UID `P3C6603E967DC8568`. All shared-template blocks reused verbatim.
- **8 panels.** Spec §3.3 rows mapped, with a 3-tile at-a-glance status header.

### gridPos layout (24-col)

| id | panel | type | x | y | w | h |
|---|---|---|---|---|---|---|
| 1 | 12 V (latest) | stat | 0 | 0 | 8 | 4 |
| 2 | LDC Status | stat | 8 | 0 | 8 | 4 |
| 3 | 12 V Sag (latest) | stat | 16 | 0 | 8 | 4 |
| 4 | 12 V by State | timeseries | 0 | 4 | 24 | 9 |
| 5 | LDC On-Voltage (driving) | timeseries | 0 | 13 | 12 | 8 |
| 6 | Parked Resting Voltage | timeseries | 12 | 13 | 12 | 8 |
| 7 | LDC OK (derived) | timeseries | 0 | 21 | 12 | 8 |
| 8 | 12 V Drop / Sag (derived) | timeseries | 12 | 21 | 12 | 8 |

### Panel details

**Panel 1 — 12 V latest (stat)**
- Target: `SELECT last("aux_12v") AS "aux_12v" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter`
- fieldConfig: `unit:"volt"`, `decimals:1`, thresholds `red(null) → orange(11.8) → green(12.2)`.
- options: stat `colorMode:"background"`, `graphMode:"none"`, `textMode:"auto"`,
  `reduceOptions {calcs:["lastNotNull"], fields:"", values:false}`, `justifyMode:"center"`,
  `orientation:"horizontal"`.
- description: `Latest 12 V auxiliary battery reading in any state (bms/2101 aux_12v). Bands mirror the parked-only alerts (critical <11.8 V, low <12.2 V) but this tile shows the latest reading in ANY state, so a driving dip can colour it without raising an alert. ~13.5-14.5 V means the LDC is actively charging the 12 V battery — healthy.`

**Panel 2 — LDC Status (stat)**
- Target: `SELECT last("value") AS "ldc_ok" FROM "ioniq" WHERE "group"='derived/ldc_ok' AND $timeFilter`
- fieldConfig: `unit:"none"`, mappings value-map `{"0":{text:"Not charging",color:"red",index:0}, "1":{text:"OK",color:"green",index:1}}`, thresholds `red(null) → green(1)`.
- options: stat `colorMode:"background"`, else as P1.
- description: `Latest derived LDC health flag (derived/ldc_ok): 1 = the DC-DC converter is keeping the 12 V bus up, 0 = not charging (alert fires below 1). Dense signal.`

**Panel 3 — 12 V Sag latest (stat)**
- Target: `SELECT last("value") AS "aux12v_drop" FROM "ioniq" WHERE "group"='derived/aux12v_drop' AND $timeFilter`
- fieldConfig: `unit:"volt"`, `decimals:2`, thresholds `green(null) → red(0.1)`.
- options: stat `colorMode:"background"`, else as P1.
- description: `Latest derived 12 V sag magnitude (derived/aux12v_drop) — how far the aux battery has dropped below its expected resting level. 0 = healthy; the alert fires above 0. Threshold coloring turns red at ≥0.1 V because a value of exactly 0 is the normal, healthy state. Dense signal.`

**Panel 4 — 12 V by State (timeseries)** — parked/charging SPARSE
- Target: `SELECT mean("aux_12v") AS "aux_12v" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time($__interval), "state" fill(none)` · alias `$tag_state`
- fieldConfig: `unit:"volt"`, `decimals:1`, `color.mode:"palette-classic"`, thresholds
  `red(null) → orange(11.8) → green(12.2)`, `thresholdsStyle.mode:"line"` (draws the alert bands),
  custom `drawStyle:"line"`, `fillOpacity:0`, `showPoints:"auto"`, `spanNulls:false`.
- options: legend bottom list, tooltip multi.
- description: `12 V reading split by vehicle state (GROUP BY "state" tag → one line per active/charging/parked). state is BOTH a tag and a field here; banding uses the tag. The state distribution is heavily skewed — active ~98 %, charging ~1.3 %, parked ~0.6 % — so over a 6 h window the charging and parked lines are often ABSENT. That is real data, not a bug; widen the range to catch a parked window. The horizontal band lines are the parked-only alert thresholds (11.8 / 12.2 V).`

**Panel 5 — LDC On-Voltage (driving) (timeseries)**
- Target: `SELECT max("aux_12v") AS "ldc_on_v" FROM "ioniq" WHERE "group"='bms/2101' AND "state"='active' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `LDC on-voltage`
- fieldConfig: `unit:"volt"`, `decimals:2`, `color.mode:"palette-classic"`, thresholds off.
- options: legend bottom `calcs:["mean","max"]`, tooltip single.
- description: `Per-interval peak 12 V while driving (state='active') — a proxy for the LDC's regulated on-voltage ceiling, normally ~13.5-14.7 V. A falling ceiling over weeks suggests a weakening DC-DC converter. Uses max() because the interesting quantity is the top of the charging band, not the average.`

**Panel 6 — Parked Resting Voltage (timeseries)** — SPARSE (~0.6% of samples)
- Targets:
  - A: `SELECT min("aux_12v") AS "parked_min" FROM "ioniq" WHERE "group"='bms/2101' AND "state"='parked' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Parked min`
  - B: `SELECT percentile("aux_12v", 50) AS "parked_median" FROM "ioniq" WHERE "group"='bms/2101' AND "state"='parked' AND $timeFilter GROUP BY time($__interval) fill(none)` · alias `Parked median`
- fieldConfig: `unit:"volt"`, `decimals:2`, thresholds `red(null) → orange(11.8) → green(12.2)`,
  `thresholdsStyle.mode:"line"`, custom `showPoints:"always"`, `pointSize:6`, `spanNulls:true`.
- options: legend bottom multi, tooltip multi.
- description: `Resting 12 V while parked (state='parked') — per-interval minimum and median. This is the true health signal the parked 12 V alerts (critical <11.8 V, low <12.2 V) evaluate. parked is only ~0.6 % of samples, so this panel is NEARLY EMPTY over a 6 h window BY DESIGN — widen to several days to see the resting trend. Points (not just lines) are drawn because the data is intermittent.`

**Panel 7 — LDC OK (derived) (timeseries)**
- Target: `SELECT last("value") AS "ldc_ok" FROM "ioniq" WHERE "group"='derived/ldc_ok' AND $timeFilter GROUP BY time($__interval) fill(previous)` · alias `LDC ok`
- fieldConfig: `unit:"none"`, `min:0`, `max:1`, `decimals:0`, mappings `0→"Not charging"`, `1→"OK"`,
  thresholds `red(null) → green(1)`, custom `drawStyle:"line"`, `lineInterpolation:"stepAfter"`,
  `fillOpacity:20`.
- options: legend bottom list, tooltip single.
- description: `Derived LDC health flag over time (derived/ldc_ok, 1 = charging / 0 = not). Dense (every bms sample). Step interpolation because it is a binary state. Alert fires when it drops below 1.`

**Panel 8 — 12 V Drop / Sag (derived) (timeseries)**
- Target: `SELECT last("value") AS "aux12v_drop" FROM "ioniq" WHERE "group"='derived/aux12v_drop' AND $timeFilter GROUP BY time($__interval) fill(previous)` · alias `12 V sag`
- fieldConfig: `unit:"volt"`, `decimals:2`, `min:0`, thresholds `green(null) → red(0.1)`,
  `thresholdsStyle.mode:"line"`, custom line/area.
- options: legend bottom list, tooltip single.
- description: `Derived 12 V sag over time (derived/aux12v_drop) — depth below the expected resting voltage. Dense. Healthy at 0; the alert fires above 0, so any sustained positive excursion is worth investigating.`

---

## 3. Dashboard: `ioniq-tires`

- **uid:** `ioniq-tires` · **title:** `🚗 Ioniq EV – Tires`
- **tags:** `["ioniq","ev","vehicle"]` · **time:** `now-6h` · **refresh:** `1m` · schemaVersion 37 ·
  datasource object form UID `P3C6603E967DC8568`. All shared-template blocks reused verbatim.
- **Depends on PR0** (`derived/tire_*`, already merged + deployed). All `derived/tire_*` signals are
  **driving-gated / sparse**: they refresh only when wheel pressures change (drive/rotation). Every
  current-value tile therefore uses a **fixed `time > now() - 30d` lookback** (last-seen semantics), not
  `$timeFilter`, so a parked car still shows its last known pressures instead of "No data".
- **12 panels** (4 wheels × {psi_cold, temp_excess} tiles + two trends + spread + last-seen).

### gridPos layout (24-col)

| id | panel | type | x | y | w | h |
|---|---|---|---|---|---|---|
| 1 | FL psi (cold) | stat | 0 | 0 | 6 | 4 |
| 2 | FR psi (cold) | stat | 6 | 0 | 6 | 4 |
| 3 | RL psi (cold) | stat | 12 | 0 | 6 | 4 |
| 4 | RR psi (cold) | stat | 18 | 0 | 6 | 4 |
| 5 | FL temp excess | stat | 0 | 4 | 6 | 4 |
| 6 | FR temp excess | stat | 6 | 4 | 6 | 4 |
| 7 | RL temp excess | stat | 12 | 4 | 6 | 4 |
| 8 | RR temp excess | stat | 18 | 4 | 6 | 4 |
| 9 | Cold pressure trend (4 wheels) | timeseries | 0 | 8 | 12 | 8 |
| 10 | Temp-excess trend (4 wheels) | timeseries | 12 | 8 | 12 | 8 |
| 11 | Inter-wheel spread | timeseries | 0 | 16 | 18 | 6 |
| 12 | Tires last-seen | stat | 18 | 16 | 6 | 6 |

### Panel details

**Panels 1–4 — per-wheel cold pressure (stat), w ∈ {fl,fr,rl,rr}**
- Target (example FL): `SELECT last("value") AS "fl_psi_cold" FROM "ioniq" WHERE "group"='derived/tire_fl_psi_cold' AND time > now() - 30d` — swap `fl`→`fr`/`rl`/`rr` and the group accordingly.
- fieldConfig: `unit:"pressurepsi"`, `decimals:1`, thresholds
  `red(null) → orange(26) → green(30) → red(42)` (mirrors the tpms alerts exactly).
- options: stat `colorMode:"background"`, `graphMode:"none"`, `textMode:"auto"`,
  `reduceOptions {calcs:["lastNotNull"], fields:"", values:false}`, `justifyMode:"center"`,
  `orientation:"horizontal"`.
- description (per wheel): `Temperature-normalised cold-equivalent pressure for the <front-left> tire (derived/tire_fl_psi_cold) — this IS the value the shipped TPMS alerts evaluate (low <30, critical <26, over-inflated >42 psi). The 36 psi cold placard is the inflation target; the green 30-42 band brackets it. DRIVING-GATED: refreshes only when the pressure changes (driving/rotation), so while parked it shows the last known reading via a 30-day lookback — a frozen value is expected, not stale.`

**Panels 5–8 — per-wheel temperature excess (stat), w ∈ {fl,fr,rl,rr}**
- Target (example FL): `SELECT last("value") AS "fl_temp_excess" FROM "ioniq" WHERE "group"='derived/tire_fl_temp_excess' AND time > now() - 30d`
- fieldConfig: `unit:"celsius"`, `decimals:1`, thresholds `green(null) → red(8)` (alert hot >8 °C).
- options: stat, same as P1–4.
- description (per wheel): `How much hotter the <front-left> tire runs than the fleet baseline (derived/tire_fl_temp_excess). Healthy near 0 °C; the "tire hot" alert fires above 8 °C (a dragging brake or under-inflation signature). Driving-gated like the pressure tiles — last known value shown via a 30-day lookback while parked.`

**Panel 9 — Cold pressure trend, 4 wheels (timeseries)**
- Targets (fill(previous) carries the sparse driving-gated values across parked gaps):
  - A `SELECT last("value") AS "fl" FROM "ioniq" WHERE "group"='derived/tire_fl_psi_cold' AND $timeFilter GROUP BY time($__interval) fill(previous)` · alias `FL`
  - B …`tire_fr_psi_cold`… alias `FR` · C …`tire_rl_psi_cold`… alias `RL` · D …`tire_rr_psi_cold`… alias `RR`
- fieldConfig: `unit:"pressurepsi"`, `decimals:1`, `color.mode:"palette-classic"`, thresholds
  `red(null) → orange(26) → green(30) → red(42)`, `thresholdsStyle.mode:"dashed"` (draws the
  26/30/42 alert lines as reference; the 36 placard sits inside the green band), custom
  `drawStyle:"line"`, `showPoints:"always"`, `pointSize:6`, `spanNulls:true`.
- options: legend bottom multi, tooltip multi.
- description: `Cold-equivalent pressure trend for all four wheels (derived/tire_*_psi_cold). Driving-gated: values change only when the car is driven, and fill(previous) carries the last reading across parked gaps, so long flat segments are normal. Dashed reference lines are the alert thresholds (26 critical / 30 low / 42 over-inflated); the 36 psi cold placard is the target inside the green band. Over a 6 h parked window expect flat lines at the last known pressures.`

**Panel 10 — Temp-excess trend, 4 wheels (timeseries)**
- Targets: A–D as P9 but group `derived/tire_<w>_temp_excess`, aliases `FL`/`FR`/`RL`/`RR`.
- fieldConfig: `unit:"celsius"`, `decimals:1`, `color.mode:"palette-classic"`, thresholds
  `green(null) → red(8)`, `thresholdsStyle.mode:"dashed"`, custom line + points as P9.
- options: legend bottom multi, tooltip multi.
- description: `Per-wheel temperature-excess trend (derived/tire_*_temp_excess). Healthy near 0 °C; the dashed line at 8 °C is the "tire hot" alert threshold. One wheel diverging upward points at that corner (brake drag or low pressure). Driving-gated + fill(previous), so flat segments while parked are expected.`

**Panel 11 — Inter-wheel spread (timeseries)**
- Target: `SELECT last("value") AS "tire_spread_psi" FROM "ioniq" WHERE "group"='derived/tire_spread_psi' AND $timeFilter GROUP BY time($__interval) fill(previous)` · alias `Inter-wheel spread`
- fieldConfig: `unit:"pressurepsi"`, `decimals:1`, `min:0`, thresholds
  `green(null) → orange(3) → red(5)` (sanity guide — no dedicated spread alert ships; documented as such),
  `thresholdsStyle.mode:"line"`, custom line + points.
- options: legend bottom list, tooltip single.
- description: `Largest cold-pressure difference between any two wheels (derived/tire_spread_psi). Lower is better — a healthy set sits within ~2-3 psi. NOTE: there is no shipped alert on this signal; the 3/5 psi bands are a rough sanity guide only, not a mirror of an alert rule. Driving-gated + fill(previous); flat while parked is expected.`

**Panel 12 — Tires last-seen (stat)** — liveness, `last()` + Time field
- Target: `SELECT last("value") FROM "ioniq" WHERE "group"='derived/tire_fl_psi_cold' AND time > now() - 30d`
- fieldConfig: `unit:"dateTimeFromNow"`, thresholds `text(null)` (single step, no coloring).
- options: stat `colorMode:"none"`, `graphMode:"none"`, `textMode:"auto"`,
  `reduceOptions {calcs:["lastNotNull"], fields:"/^[Tt]ime$/", values:false}` (reduces the **Time**
  field, not the value), `justifyMode:"center"`, `orientation:"horizontal"`.
- description: `Age of the most recent derived tire sample (timestamp of last(tire_fl_psi_cold)). Because tire signals are driving-gated, an age of hours or days while parked is NORMAL and does NOT mean the feed is broken. Reduces the Time field with unit dateTimeFromNow and a fixed 30-day lookback (never count(), which cannot distinguish fresh from days-stale, and never $timeFilter, which would read "No data" the moment the window is empty).`

---

## 4. Dashboard: `ioniq-pipeline`

- **uid:** `ioniq-pipeline` · **title:** `🚗 Ioniq EV – Pipeline health`
- **tags:** `["ioniq","ev","vehicle"]` · **time:** `now-6h` · **refresh:** `1m` · schemaVersion 37 ·
  datasource object form UID `P3C6603E967DC8568`. All shared-template blocks reused verbatim.
- **11 panels.** Spec §3.5, honoring the ⚠️ sample-count proxy for storage growth.

### gridPos layout (24-col)

| id | panel | type | x | y | w | h |
|---|---|---|---|---|---|---|
| 1 | Samples/min per group | timeseries | 0 | 0 | 24 | 9 |
| 2 | BMS 2101 last-seen | stat | 0 | 9 | 4 | 4 |
| 3 | BMS 2105 last-seen | stat | 4 | 9 | 4 | 4 |
| 4 | TPMS last-seen | stat | 8 | 9 | 4 | 4 |
| 5 | Odometer last-seen | stat | 12 | 9 | 4 | 4 |
| 6 | Cells last-seen | stat | 16 | 9 | 4 | 4 |
| 7 | DTC/derived last-seen | stat | 20 | 9 | 4 | 4 |
| 8 | DTC count history | timeseries | 0 | 13 | 12 | 8 |
| 9 | Sample-count growth (proxy) | timeseries | 12 | 13 | 12 | 8 |
| 10 | Stored DTC codes | table | 0 | 21 | 12 | 8 |
| 11 | Pending DTC codes | table | 12 | 21 | 12 | 8 |

### Panel details

**Panel 1 — Samples/min per group (timeseries)** — ONE target per group (disjoint field sets)
- Targets (each counts that group's always-populated field, `GROUP BY time(1m) fill(0)`):
  - A `SELECT count("soc") AS "bms2101" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time(1m) fill(0)` · alias `bms/2101`
  - B `SELECT count("soc_display") AS "bms2105" FROM "ioniq" WHERE "group"='bms/2105' AND $timeFilter GROUP BY time(1m) fill(0)` · alias `bms/2105`
  - C `SELECT count("fl.psi") AS "tpms" FROM "ioniq" WHERE "group"='tpms' AND $timeFilter GROUP BY time(1m) fill(0)` · alias `tpms`
  - D `SELECT count("km") AS "odometer" FROM "ioniq" WHERE "group"='odometer' AND $timeFilter GROUP BY time(1m) fill(0)` · alias `odometer`
  - E `SELECT count("cells") AS "cells1" FROM "ioniq" WHERE "group"='cells/1' AND $timeFilter GROUP BY time(1m) fill(0)` · alias `cells/1` — **VALIDATION TODO:** confirm the `cells/1` field name is `cells` via `SHOW FIELD KEYS FROM "ioniq"` scoped to that group before finalizing; adjust the field if prod differs.
  - F `SELECT count("value") AS "dtc" FROM "ioniq" WHERE "group"='derived/dtc_count' AND $timeFilter GROUP BY time(1m) fill(0)` · alias `derived/dtc_count`
- fieldConfig: `unit:"short"`, `decimals:0`, `min:0`, `color.mode:"palette-classic"`, custom
  `drawStyle:"line"`, `fillOpacity:10`, `showPoints:"never"`, `spanNulls:false`, thresholds off.
- options: legend bottom `calcs:["mean","max"]`, tooltip multi.
- description: `Per-group ingest rate — samples landing per 1-minute bucket, one line per MQTT group. Groups carry disjoint field sets, so this is deliberately one query per group counting that group's always-populated field (not one generic query). count()-per-time(1m) is correct HERE (a rate over the awake window, not a liveness check). While awake, bms telemetry is ~0.5 s cadence (~120/min); while the car sleeps every group drops to 0 across all lines together — that is the car sleeping, not a pipeline outage. Use the last-seen tiles below to judge staleness.`

**Panels 2–7 — per-group last-seen (stat)** — `last()` + Time field, 30-day lookback
- Targets (reduce the Time field; note the fixed 30d lookback, NOT `$timeFilter`):
  - P2 BMS 2101: `SELECT last("soc") FROM "ioniq" WHERE "group"='bms/2101' AND time > now() - 30d`
  - P3 BMS 2105: `SELECT last("soc_display") FROM "ioniq" WHERE "group"='bms/2105' AND time > now() - 30d`
  - P4 TPMS: `SELECT last("fl.psi") FROM "ioniq" WHERE "group"='tpms' AND time > now() - 30d`
  - P5 Odometer: `SELECT last("km") FROM "ioniq" WHERE "group"='odometer' AND time > now() - 30d`
  - P6 Cells: `SELECT last("cells") FROM "ioniq" WHERE "group"='cells/1' AND time > now() - 30d` (same field-name VALIDATION TODO as P1-E)
  - P7 DTC/derived: `SELECT last("value") FROM "ioniq" WHERE "group"='derived/dtc_count' AND time > now() - 30d`
- fieldConfig: `unit:"dateTimeFromNow"`, thresholds `text(null)`.
- options: stat `colorMode:"none"`, `graphMode:"none"`, `textMode:"auto"`,
  `reduceOptions {calcs:["lastNotNull"], fields:"/^[Tt]ime$/", values:false}`, `justifyMode:"center"`,
  `orientation:"horizontal"`. Panel `title` names the group (e.g. "BMS 2101").
- description (shared idiom, name the group): `Age of the newest sample in <group> (timestamp of its last() value). Reduces the Time field with unit dateTimeFromNow over a fixed 30-day lookback — last() reports AGE while count() reports only presence, and neither survives an empty window, so $timeFilter is avoided. Hours/days old while the car sleeps is normal; a group far staler than its siblings is the real signal of a stuck feed.`

**Panel 8 — DTC count history (timeseries)**
- Target: `SELECT last("value") AS "dtc_count" FROM "ioniq" WHERE "group"='derived/dtc_count' AND $timeFilter GROUP BY time($__interval) fill(previous)` · alias `DTC count`
- fieldConfig: `unit:"none"`, `decimals:0`, `min:0`, thresholds `green(null) → red(1)`,
  `thresholdsStyle.mode:"line"`, custom `drawStyle:"line"`, `lineInterpolation:"stepAfter"`,
  `fillOpacity:20`.
- options: legend bottom list, tooltip single.
- description: `Active diagnostic-trouble-code count over time (derived/dtc_count). Dense; 0 = healthy (a flat green line at 0 is the normal state). Any step above 0 also raises the Ioniq DTC alert; the stored/pending code tables below show which codes.`

**Panel 9 — Sample-count growth, proxy (timeseries)** (⚠️ v1 substitute for DB-size growth)
- Target: `SELECT cumulative_sum(count("soc")) AS "cum_samples" FROM "ioniq" WHERE "group"='bms/2101' AND $timeFilter GROUP BY time(1h) fill(0)` · alias `Cumulative samples`
- fieldConfig: `unit:"short"`, `decimals:0`, `min:0`, `color.mode:"palette-classic"`, custom
  `drawStyle:"line"`, `fillOpacity:20`, thresholds off.
- options: legend bottom list, tooltip single.
- description: `PROXY for storage growth: the running cumulative count of bms/2101 samples over the window (cumulative_sum of hourly count). True InfluxDB/Mongo on-disk size is NOT queryable from the ioniq measurement via InfluxQL — a real DB-size panel is deferred to a future storage exporter (spec §3.5). The slope is the ingest rate; it flattens whenever the car sleeps. Read this as "how fast the main series is accumulating", not as bytes on disk.`

**Panel 10 — Stored DTC codes (table)**
- Target: `SELECT * FROM "ioniq" WHERE "group"='dtc/stored' AND $timeFilter ORDER BY time DESC LIMIT 20`
  - `SELECT *` returns whatever fields the code-list group carries without needing to know their names.
  - **VALIDATION TODO:** confirm the `dtc/stored` group and its field shape against prod
    (`SHOW FIELD KEYS`) during validation; if it carries a single code-list string field, keep `*`.
- fieldConfig: table `custom {align:"auto", displayMode:"list", inspect:false}`; `overrides` by `byName`
  on `Time` → `displayName:"Timestamp"`, `unit:"time: YYYY-MM-DD HH:mm:ss"`, `custom.width:180`.
- options: `{showHeader: true}`.
- description: `Most recent stored (confirmed) diagnostic trouble codes (group dtc/stored). An EMPTY table is the healthy state — it means no codes are stored. Codes are string values; the DTC-count panel above is the numeric summary this table itemises.`

**Panel 11 — Pending DTC codes (table)**
- Target: `SELECT * FROM "ioniq" WHERE "group"='dtc/pending' AND $timeFilter ORDER BY time DESC LIMIT 20` (same VALIDATION TODO as P10).
- fieldConfig / options: identical to P10.
- description: `Most recent pending (not-yet-confirmed) diagnostic trouble codes (group dtc/pending). Empty = healthy. Pending codes are intermittent faults that have not yet matured into stored codes; watch for one that keeps reappearing.`

---

## 5. Build order & validation (per dashboard)

1. Clone `ioniq-overview.json` → new file; strip its `panels` to `[]`; set `uid`, `title`,
   `description`, `time.from: "now-6h"`. Keep all shared blocks byte-for-byte.
2. Add panels per the tables above, ids sequential from 1, unique, `gridPos` exactly as tabulated.
3. `python3 -m json.tool <file> >/dev/null` (valid) and key-order check (§0 list).
4. Provision into the local Grafana 9.5.21 harness (build brief §6: local container + read-only SSH
   tunnel to prod InfluxDB). For each target, read it back through the datasource proxy and confirm it
   returns the expected field/tag and real data. Verify sparse panels against a historical rest/drive
   window (they will look empty at a daytime review — that is expected and documented).
5. Resolve the two field-name VALIDATION TODOs (`cells/1` field, `dtc/stored`/`dtc/pending` shape) with
   `SHOW FIELD KEYS`/`SHOW TAG VALUES` before finalizing; adjust queries if prod differs and say so loudly.
6. Confirm rendered folder title reads exactly `Ioniq EV` and the tag-nav dropdown now lists all
   ioniq-tagged dashboards. No `logger=provisioning.dashboard` errors, no ioniq errors. (The brief's
   `finished to provision dashboards` log line does not exist in 9.5.21 — use the `/api/search` folder
   read-back as positive evidence, per the PR1 plan correction.)
7. Commit each dashboard with selective staging + the Claude-Session trailer. Tear down the harness.

## 6. Spec coverage check

- **§3.2 battery:** SoC/SoH (P1); cell max/min (P2) + cell spread (P3, sparse, spike-tolerant axis);
  ⚠️ heatmap→temp max/min (P4) + module spread (P5); isolation (P6, pinned); charge/discharge envelope
  (P7, pinned); cumulative Ah/kWh (P8) + ⚠️ approximate windowed efficiency (P9). ✅
- **§3.3 12v-ldc:** aux_12v by state (P4); LDC on-voltage (P5); parked resting voltage (P6, sparse);
  derived ldc_ok (P7) + aux12v_drop (P8); plus status header (P1–3). ✅
- **§3.4 tires:** per-wheel psi_cold (P1–4 + trend P9); inter-wheel spread (P11); per-wheel temp-excess
  (P5–8 + trend P10); 36 psi placard referenced in psi_cold coloring/description; last-seen (P12). ✅
- **§3.5 pipeline:** samples/min per group, one target per group (P1); per-group last-seen (P2–7); DTC
  history (P8) + stored/pending code tables (P10/11); ⚠️ storage-growth sample-count proxy (P9). ✅
