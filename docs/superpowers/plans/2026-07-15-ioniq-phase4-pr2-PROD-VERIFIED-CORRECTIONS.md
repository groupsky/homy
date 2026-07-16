# PR2 — Prod-verified field corrections (read-only, 2026-07-16)

Queried prod InfluxDB read-only via `ssh routy` to resolve the plan's open field-shape TODOs.
These OVERRIDE any conflicting field assumption in the build plan. Bake them into the JSON queries.

## 1. `cells/1` group — per-cell array is a JSON STRING, not numeric
- Fields present: `cells` (JSON string, e.g. `[3.96,3.96,...]` — 32 values) and `seq` (numeric, e.g. 13049).
- InfluxQL CANNOT aggregate the `cells` string numerically. The battery dashboard's numeric cell panels
  MUST use `bms/2101 cell_max_v`, `cell_min_v` and `derived/cell_spread_mv value` (as spec §3.2 already says).
- Pipeline "samples/min" for the cells group: use **`count("seq")`** (numeric, always populated) — NOT `count("cells")`.
  `SELECT count("seq") FROM "ioniq" WHERE "group"='cells/1' AND $timeFilter GROUP BY time(1m)`.

## 2. `dtc/stored` / `dtc/pending` — code list is field `codes` (JSON string), NOT `value`
- Latest sample: `codes = []` (empty JSON array string). There is NO `value` field on these groups.
- DTC code-list panels query **`codes`**: `SELECT last("codes") FROM "ioniq" WHERE "group"='dtc/stored'`
  (table/stat of the last code array). Expect `[]` when healthy — note that in the panel description.
- The numeric DTC count remains `derived/dtc_count value` (unchanged).

## 3. PR0 IS deployed to prod — `derived/tire_*` is live
- All 9 tire groups exist: `derived/tire_{fl,fr,rl,rr}_psi_cold`, `derived/tire_{fl,fr,rl,rr}_temp_excess`,
  `derived/tire_spread_psi`. `tire_fl_psi_cold` last value = **32.7**; 279 samples all-time.
- The `ioniq-tires` dashboard will render real data now. Field is `value`, group `derived/tire_*`, as spec §3.4.

## 4. Unchanged / confirmed
- All bms/2101 + bms/2105 + odometer + tpms fields exactly as brief §4. Tag keys only `group`, `state`.
