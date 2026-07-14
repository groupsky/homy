# Ioniq EV Monitoring — Phase 3 Implementation Design (computation bots)

Status: approved for planning · Date: 2026-07-14 · Parent spec:
[`docs/ioniq-monitoring-alerting-spec.md`](../../ioniq-monitoring-alerting-spec.md) (rollout phase 3)
Phase-2 template: [`2026-07-14-ioniq-monitoring-phase2-design.md`](2026-07-14-ioniq-monitoring-phase2-design.md)

This is the **umbrella contract** for Phase 3. Each bot below is implemented in its own git worktree
by an independent orchestrator that produces a per-bot spec → plan → TDD → review → PR. This document
fixes the shared scope, data shapes, conventions, and gotchas so the three streams stay consistent.

## 1. Scope

Phase 3 builds the **computation bots** (spec §5) whose conditions Grafana/InfluxQL express poorly
(array logic, cross-field math, rolling/stateful edges). Each bot reduces its condition to a clean
numeric signal on `ioniq/parsed/derived/<name>` so the existing `mqtt-influx-ioniq` bridge writes it to
InfluxDB and Grafana alerts on it with a trivial threshold.

**In scope — three bespoke bots, one worktree + PR each:**
- `ioniq-cell-health` → `derived/cell_spread_mv`, `derived/module_temp_spread_c`
- `ioniq-12v-ldc` → `derived/ldc_ok`, `derived/aux12v_drop`
- `ioniq-tpms` → `derived/tire_<w>_psi_cold` (×4), `derived/tire_spread_psi`, `derived/tire_<w>_temp_excess`

Each PR bundles: `docker/automations/bots/<bot>.js` + `<bot>.test.js`, registration in
`config/automations/config.js`, the bot's Grafana derived-threshold rule file under
`config/grafana/provisioning/alerting/`, and the `docs/influxdb-schema.md` update for the new
`derived/*` groups.

**Deferred (out of scope for phase 3):**
- **`ioniq-charge-guard`** (`soc_at_park`, `charge_stalled`, `charge_reduced_rate`) → **Phase 3.5**,
  its own brainstorm/spec. Data is now available (see §2) but it is the most complex bot (correlating
  three MQTT groups by time) and is split out to keep phase 3 tight and de-risked.
- **Connectivity / data-liveness (`telemetry_stale`)** → **DROPPED.** A session-aware staleness
  watchdog was judged too unreliable to be worth shipping (false-positive risk on the car's normal
  power-cycling outweighs the value). Not implemented in phase 3; revisit only if a robust design emerges.
- **Dashboards (§7)** → Phase 4, after these derived signals are landing in InfluxDB.

## 2. Prod verification findings (2026-07-14, read-only queries on routy)

Confirmed live against prod InfluxDB (db `homy`, measurement `ioniq`) and MongoDB. **These exact
field/tag/topic strings are the contract — do not trust the parent spec's names blindly, they were
re-verified here.**

- **`group` tag values now in InfluxDB:** `ambient, bcm_b00e, bms/2101, bms/2105, cells/1, cells/33,
  cells/65, derived/dtc_count, dtc/pending, dtc/stored, gps, hvac, mcu, net, obc, odometer, tpms, vmcu`.
  **Change since phase 2: `bcm_b00e` and `obc` are now promoted to InfluxDB** (P0-1 done by the logger
  team) — this unblocks charge-guard but that's phase 3.5.
- **`state` tag values:** `active`, `charging`, `parked`.
- **`cells/1` · `cells/33` · `cells/65`:** each row carries a single field **`cells`** stored as a
  **JSON string** of 32 floats, e.g. `"[3.68,3.68,…]"`. `cells/1`→cells 1–32, `cells/33`→33–64,
  `cells/65`→65–96 (96 total). Must `JSON.parse` and guard malformed input.
- **`bms/2101`:** `aux_12v` (V), `ignition` (0/1 field), `hv_kw`, `charging` (0/1 field), `soc`,
  `cell_max_v`, `cell_min_v`, `temp_max`, `temp_min`, `inlet`, `module_temps` (**JSON string**, 5 floats
  = modules 1–5), `ac_port`/`dc_port` (0/1). Fast tier (~0.5 s).
- **`bms/2105`:** `soh`, `module_temps_6_12` (**JSON string**, 7 floats = modules 6–12), `heater_1`,
  `heater_2`, `cell_v_dev` (deadbanded to 0 — **do not use**). Slow tier (~75 s).
- **`tpms`:** dotted fields **`fl.psi`, `fl.c`, `fr.psi`, `fr.c`, `rl.psi`, `rl.c`, `rr.psi`, `rr.c`**
  (`.c` = temperature °C). Quote dotted fields in InfluxQL (`"fl.psi"`). Refreshes only on wheel
  rotation — frozen/duplicated while parked.
- **`ambient`:** temperature field is **`c`** (e.g. `30.5`). (A `outdoor_c` key exists in schema but was
  not populated in sampled rows — use `c`.)

## 3. Derived-signals convention (P0-4 — all bots MUST follow)

Every emitted object on `ioniq/parsed/derived/<name>` MUST include the fields the `mqtt-influx-ioniq`
bridge needs, exactly as `ioniq-dtc` does:

```js
mqtt.publish('ioniq/parsed/derived/<name>', {
  _type: 'ioniq',            // REQUIRED — bridge rejects the message without it
  group: 'derived/<name>',   // becomes the InfluxDB `group` tag
  state,                     // pass through the source sample's state
  ts,                        // pass through the source sample's ts
  value: <number>,           // the numeric alert input Grafana thresholds on
  // …optional extra fields (e.g. codes, cellIndex) for history/dashboards
})
```

The framework's `mqtt.publish` also injects `_bot` and `_tz`; the converter writes those as extra
series fields — harmless, Grafana only reads `value`. `mqtt.publish` takes a **JS object**, never a
JSON string.

## 4. Bot designs

All bots follow the repo pattern `module.exports = (name, config) => ({ persistedCache, start })`,
receive **parsed JS objects** from `mqtt.subscribe` (framework JSON-parses), use **exact-match topic
subscriptions** (no wildcards — a wrong string silently no-ops), and ship with Jest tests using the
repo's mocked-MQTT pattern. `ioniq-dtc.js` is the reference for shape, persisted-cache versioning, and
HTML-escaping.

### 4.1 `ioniq-cell-health`

**Subscribes:** `ioniq/parsed/cells/1`, `ioniq/parsed/cells/33`, `ioniq/parsed/cells/65`,
`ioniq/parsed/bms/2101`, `ioniq/parsed/bms/2105` (exact topics; inferred from the `group` tags — verify
live with `mosquitto_sub` at implementation, config-overridable).

**Emits:**
- `derived/cell_spread_mv` — reassemble the 96-cell array from the three `cells` JSON strings, compute
  `(max − min) · 1000` in mV, and include the **outlier cell index** (1–96, the cell furthest from the
  pack mean) in the payload as an extra field. **Skip emission when `state === 'active'`** — this is a
  rest-spread signal (§4.1); only emit for `parked`/`charging`. Emit only when all three arrays are
  present/fresh (hold last-known per-segment in `persistedCache`; guard against a stale segment).
- `derived/module_temp_spread_c` — merge 12 module temps (`module_temps`[5] from 2101 +
  `module_temps_6_12`[7] from 2105, both JSON strings) → `max − min` °C.

**Thresholds (Grafana):** `cell_spread_mv > 50` warn / `> 100` crit, `for: 10m`.
`module_temp_spread_c > 8` warn / `> 15` crit, `for: 10m`. (baseline: 20 mV, 2 °C)

Note: coarse pack spread (`cell_max_v − cell_min_v` from `bms/2101`) is directly Grafana-expressible but
is **not** built here — the bot's full-reassembly signal supersedes it and adds the outlier index.

### 4.2 `ioniq-12v-ldc`

**Subscribes:** `ioniq/parsed/bms/2101`.

**State:** rolling window of recent `{aux_12v, ignition, hv_kw, state, ts}` samples (bounded, in
`persistedCache`).

**Emits:**
- `derived/ldc_ok` (0/1) — `0` (not charging) when `max(aux_12v) < 13.2 V` while `ignition === 1` and a
  recent low-`hv_kw` sample, sustained ≥ 60 s; else `1`. This encodes the suppression rule: 12.9 V float
  under heavy traction is normal LDC load-priority, not a fault, so the low-voltage judgement is gated
  on low HV load.
- `derived/aux12v_drop` (0/1) — `1` on a sag edge: `aux_12v` drop ≥ 0.8 V within 5 s, **or** ≥ 0.3 V/min
  while `state === 'parked'`; else `0`.

**Thresholds (Grafana):** `ldc_ok < 1` warn, `for: 60s`. `aux12v_drop > 0` warn, `for: 0s`.

### 4.3 `ioniq-tpms`

**Subscribes:** `ioniq/parsed/tpms`, `ioniq/parsed/ambient`.

**Logic:** cold-normalize each wheel to 15 °C: `psi_cold = psi − 0.18·(temp − 15)` using the wheel's own
`.c` temp (fall back to `ambient.c` if a wheel temp is missing). TPMS only refreshes on rotation →
**evaluate on fresh `state === 'active'` samples only** and dedupe unchanged/frozen values (hold last
raw reading in `persistedCache`; skip if identical to the prior sample).

**Emits (per fresh active sample):**
- `derived/tire_fl_psi_cold`, `…_fr_…`, `…_rl_…`, `…_rr_…` — four separate signals, one per wheel.
- `derived/tire_spread_psi` — `max − min` of the four cold-normalized pressures.
- `derived/tire_fl_temp_excess` … `_rr_…` — per wheel: `wheel_temp − mean(other three) ` °C (or a 0/1
  flag when `> 8 °C`; per-bot spec picks representation, keep Grafana threshold trivial).

**Thresholds (Grafana):** per-wheel `psi_cold < 30` warn / `< 26` crit (placard 36, no spare).
`tire_spread_psi > 3` warn. per-wheel `temp_excess > 8` warn. over-inflation `psi_cold > 42` info.

## 5. Grafana derived-threshold rules (shared shape)

One rule file per bot under `config/grafana/provisioning/alerting/`
(`ioniq-cell-health-alerts.yaml`, `ioniq-12v-ldc-alerts.yaml`, `ioniq-tpms-alerts.yaml`), cloning the
phase-2 / `sunseeker-*` canonical shape. **Every rule MUST:**
- Use `classic_conditions` (never `threshold`).
- Query `SELECT last("value") FROM "ioniq" WHERE "group"='derived/<name>' AND time >= now() - <window>`
  — explicit time bound, never `$timeFilter`.
- Set `noDataState: OK` (the car sleeps; absence of data ≠ alert) and `execErrState: Alerting`.
- Use datasource UID `P3C6603E967DC8568`, folder `Ioniq EV`, group `interval: 1m`
  (≤ every rule's `for:`).
- Give every `__expr__` node a full model: `datasource: {type: __expr__, uid: __expr__}`,
  `intervalMs: 1000`, `maxDataPoints: 43200`, `refId: A`, `hide: false`.
- Carry `🚗` in `title`/`summary` and labels `severity` (warning|critical|info), `device: ioniq`,
  `subsystem` (battery|12v|tpms). Each warn/crit pair is two separate rules.
- Use static annotation text (`classic_conditions` drops GROUP BY labels; all Ioniq rules are
  single-series so no `{{ $labels.* }}`). `{{ $values.A.Value }}` is fine for a number.

Notification routing (§3 of parent spec) already exists from phase 2 (`device = ioniq` severity routes)
— no routing changes needed.

## 6. Orchestration model

Three **opus orchestrators**, each in its own **git worktree**, dispatched in **parallel** (background).
Each orchestrator:
1. Writes a per-bot design spec + implementation plan (using this doc as the parent contract).
2. Runs subagent-driven **TDD** (Jest, mocked MQTT/HTTP; sonnet for implementation, haiku for mechanical
   transcription) — red → green → refactor.
3. Runs **independent fresh-subagent review gates** — spec review, plan review, per-task review,
   whole-branch review, and a fresh PR review before the merge recommendation. The author never reviews
   itself. Model matched to difficulty (opus for the hard review gates).
4. Verifies field/tag/topic strings against **prod** (read-only) before writing queries; verifies the
   built automations image contains the new module (`grep` for `MODULE_NOT_FOUND`) as part of the
   deploy-readiness check.
5. Opens a PR that is implemented, TDD-tested, and independently reviewed, carrying a clear
   **GOOD TO MERGE** verdict (with evidence) or **FAILURE: <reason>**. The human decides merges.

**Commits:** selective staging only (never `git add .`); end every commit body with the
`Claude-Session` trailer.

**Merge coordination:** the three PRs each append to `config/automations/config.js` and
`docs/influxdb-schema.md`. Conflicts are trivial (append-only, disjoint blocks) and resolved as PRs are
merged one at a time.

## 7. Deliverables checklist (per bot)

- [ ] `docker/automations/bots/<bot>.js` + `<bot>.test.js` (TDD, full scenario coverage)
- [ ] `config/automations/config.js` — bot registered
- [ ] `config/grafana/provisioning/alerting/<bot>-alerts.yaml` — derived-threshold rules
- [ ] `docs/influxdb-schema.md` — new `derived/*` groups documented
- [ ] `example.env` / `secrets/` — only if new config surfaces (none expected; webhook has in-code default)
- [ ] Independent review verdict: GOOD TO MERGE (evidence) or FAILURE
