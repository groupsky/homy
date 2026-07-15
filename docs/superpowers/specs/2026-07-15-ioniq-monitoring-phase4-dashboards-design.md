# Ioniq EV Monitoring — Phase 4: Dashboard Family (v1) Design

**Date:** 2026-07-15
**Status:** Approved (design), pending implementation
**Spec reference:** `docs/ioniq-monitoring-alerting-spec.md` §7 (dashboards), §4 (signal→panel), §9 (rollout), §10 (open items)
**Prior-phase templates:** `2026-07-14-ioniq-monitoring-phase2-design.md`, `2026-07-14-ioniq-monitoring-phase3-design.md`
**Canonical dashboard shape to clone:** `config/grafana/dashboards/sunseeker-{overview,navigation,battery}.json`, `heatpump.json`

---

## 0. Context & prerequisite status

Phases 1–3 are shipped and merged (#1385, #1387, #1388, #1389). As of 2026-07-15 the Phase-3
`automations` image is **deployed to prod** (routy) and all derived signals were verified emitting:

- Dense (every bms/2101 sample): `derived/module_temp_spread_c`, `derived/ldc_ok`, `derived/aux12v_drop`, `derived/dtc_count`.
- Sparse by design: `derived/cell_spread_mv` (rest-only — ioniq-cell-health skips `state==='active'`; emits only when `state` ∈ {charging, parked}).
- **BROKEN (Phase-3 bug, must be fixed first — see §1.1): `derived/tire_*`** never emits. `count(value)` for
  `group =~ /^derived\/tire/` is zero all-time. The live `ioniq/parsed/tpms` payload is **nested**
  (`{"fl":{"psi":37.2,"c":39}, ...}`) but `ioniq-tpms.js` (merged #1387) reads **flat** `payload['fl.psi']`
  → always `undefined` → no `publish()` ever. The flat `fl.psi` fields visible in InfluxDB are produced by
  the mqtt-influx converter flattening at write time, not what the bot receives. This also makes the
  Phase-3 tpms **alert rules dead** (they fire on signals that never populate).

**Consequence for this phase:** the cell-spread panel is intermittent (rest-only) and MUST use
`last()`/`fill(previous)` and last-seen (`last()` + time) semantics, never `count()`-based liveness (an
empty window returns no row while the car sleeps). The tire panels depend on the §1.1 bot fix landing
before they carry any data.

## 1. Goal & scope

Deliver the **Ioniq EV** Grafana dashboard family (spec §7) as hand-authored provisioned JSON.

**v1 = 5 dashboards** (all direct queries over verified parsed/derived fields):

| UID | Title | Purpose |
|---|---|---|
| `ioniq-overview` | 🚗 Ioniq EV – Overview | At-a-glance: SoC, pack V/A/kW, 12 V, DTC, last-seen, odometer, 4 tire stats, active-alert list |
| `ioniq-battery` | 🚗 Ioniq EV – Battery health | SoC/SoH trend, cell max/min/spread, module-temp spread, isolation, charge/discharge envelope, cumulative Ah/kWh |
| `ioniq-12v-ldc` | 🚗 Ioniq EV – 12 V / LDC | aux_12v banded by state, LDC on-voltage, parked resting-voltage, derived ldc_ok / aux12v_drop |
| `ioniq-tires` | 🚗 Ioniq EV – Tires | Per-wheel psi_cold, inter-wheel spread, temp-excess, over/under bands |
| `ioniq-pipeline` | 🚗 Ioniq EV – Pipeline health | Samples/min per group, per-group last-seen, DTC history, sample-count growth |

**Explicitly deferred:** **Trips & charging** (spec §7 row 5). Its per-trip distance/energy/efficiency,
regen-recovery %, and charge-session breakdowns need trip/charge **session boundaries** that no bot
emits; pure-InfluxQL session math is fragile and unvalidatable. Deferred to a future phase powered by a
segmentation bot (its own brainstorm, akin to charge-guard Phase 3.5). **No v1 panel depends on the
charge-guard signals or the charger ORNO meter.**

**Non-goals:** no UI-built dashboards (`allowUiUpdates:false` → every dashboard fully hand-authored in
JSON); no new bots; no changes to alert rules or notification routing (Phase 2/3 already shipped those),
except the tpms-bot bugfix in §1.1 which restores the already-shipped tire signals/alerts.

### 1.1 Prerequisite bugfix — `ioniq-tpms` nested-payload access (standalone PR, ships first)

The `ioniq-tires` dashboard has no data until `derived/tire_*` actually emits, and the Phase-3 tpms alert
rules are currently dead. Fix `docker/automations/bots/ioniq-tpms.js` to read the **nested** payload
(`payload[w].psi` / `payload[w].c`, `w` ∈ {fl,fr,rl,rr}) instead of the flat `payload['fl.psi']` /
`payload['fl.c']`. Update the bot's **test fixtures to the real nested shape** (the current flat fixtures
are why the bug passed review) and confirm the tests fail before the fix and pass after (TDD). Ships as a
**standalone bugfix PR before the dashboard PRs**; after merge, deploy to prod, verify `derived/tire_*`
begins landing (drive/rotation required to change pressures) and the tpms alert rules recover from their
dead/NoData state. Output signal names are unchanged: `tire_<w>_psi_cold`, `tire_spread_psi`,
`tire_<w>_temp_excess`, group `derived/<name>`, field `value`.

> Known adjacent issue (NOT in this fix's scope, tracked as a follow-up): `ioniq-cell-health` can publish
> `derived/cell_spread_mv value=3800` (an impossible 3.8 V spread) when a `cells/*` segment frame arrives
> all-zeros — a length-32 finite array passes `parseFloatArray`, so `min=0` yields `spread≈max*1000`. The
> §3.2 cell-spread panel must set axis/thresholds that tolerate an occasional absurd spike rather than
> auto-scaling to it.

## 2. Provisioning, folder & shared template

### 2.1 Datasource (non-negotiable)

- InfluxDB **v1 / InfluxQL** (NOT Flux), datasource UID `P3C6603E967DC8568`, db `homy`, measurement `ioniq`.
- Every target quotes `"group"` (reserved word) and any dotted field (`"fl.psi"`, `"fl.c"`). String
  literals single-quoted (`'active'`). Verify every query against prod before finalizing (read-only recipe below).

### 2.2 Folder

Provider `config/grafana/provisioning/dashboards/dashboards.yaml` has `foldersFromFilesStructure: true`,
so a **subdirectory name becomes the Grafana folder title**. Existing dashboards sit in the flat root
(→ General folder). Place the 5 files in a new subdir under `config/grafana/dashboards/` whose rendered
folder title is **"Ioniq EV"** (matching the Phase-2 *alert* folder). The exact directory name is an
implementation detail: create it, provision into a live Grafana, and **verify the rendered folder title
reads "Ioniq EV"** before declaring done. (If a spaced dir name is undesirable or renders wrong, adjust
and re-verify.)

### 2.3 Shared template (authored in PR1, cloned by PR2)

- **Tags:** every dashboard carries `["ioniq", "ev", "vehicle"]`.
- **Navigation:** **tag-based** dashboard links — a dashboard-links row of `type: dashboards` filtered to
  tag `ioniq`. This is a deliberate improvement over the sunseeker family's hardcoded `/d/<uid>` URL
  links: the nav dropdown auto-populates as PR2 siblings (and a future Trips dashboard) land, so there
  are no dead links and no cross-PR file edits. (Approved 2026-07-15.)
- **Time ranges / refresh:** Overview default `now-24h`, detail dashboards `now-6h`; refresh `1m` across
  the family (repo standard).
- **Panel types:** `stat`, `timeseries`, `bargauge`, `table`, `heatmap` have in-repo precedent
  (sunseeker/heatpump) — clone them. `gauge` (Overview SoC) and `alertlist` (Overview active-alert list)
  have **no in-repo template** (repo-wide grep: zero usage), so PR1's template-design gate must budget to
  author these two from Grafana docs rather than assuming a copy-paste source. No custom panel plugins.
- **Sparsity-aware querying:** tire and cell-spread panels use `last()`/`fill(previous)` and last-seen
  (`last()` + time); never `count()`-based liveness.

## 3. Per-dashboard panel → verified-field mapping

All fields below verified live against prod InfluxDB on 2026-07-15. ⚠️ marks a spec §7 panel that current
data cannot fully support, with the v1 substitute.

### 3.1 Overview (`ioniq-overview`)

| Panel | Source |
|---|---|
| SoC + SoC_display gauge | `bms/2101 soc`, `bms/2105 soc_display` |
| Pack V/A/kW stats | `bms/2101 hv_v, hv_a, hv_kw` |
| 12 V (color-banded stat) | `bms/2101 aux_12v` |
| DTC status | `derived/dtc_count value` (0 = healthy) |
| Last-seen stat | `last(soc)` + time (sparsity-safe) |
| Odometer | `odometer km` |
| Tire pressures (4 stats) | `tpms "fl.psi","fr.psi","rl.psi","rr.psi"` via `last()` (frozen while parked = expected) |
| Active-alert list | Grafana `alertlist` panel filtered to the "Ioniq EV" alert folder |

### 3.2 Battery health (`ioniq-battery`)

| Panel | Source |
|---|---|
| SoC & SoH trend | `bms/2101 soc`, **`bms/2105 soh`** (SoH lives in 2105, not 2101 — verified) |
| Cell max/min/spread | `bms/2101 cell_max_v, cell_min_v` + `derived/cell_spread_mv value` (+`outlierIndex`; sparse/rest-only). Set axis/thresholds to tolerate the occasional impossible ~3800 mV spike (see §1.1 known issue) — do NOT auto-scale to it. |
| ⚠️ 12-module temp heatmap | **Not buildable** — `module_temps`/`module_temps_6_12` are JSON-string fields; InfluxQL can't index them. **v1:** `bms/2101 temp_max, temp_min` + `derived/module_temp_spread_c value`. Full per-module heatmap needs a future array-explosion bot. |
| Isolation | `bms/2101 isolation_kohm` (pinned ~1000 = healthy ceiling; flat unless fault) |
| Charge/discharge envelope | `bms/2101 avail_chg, avail_dis` (pinned ~98; mostly flat) |
| Cumulative Ah/kWh | `cum_chg_ah, cum_dis_ah, cum_in_kwh, cum_out_kwh` (raw + windowed deltas) |
| ⚠️ Usable-Ah / round-trip efficiency | Counters do not span full vehicle life (memory: "look reset"). **v1:** windowed delta ratio labeled *approximate*, not a lifetime figure. |

### 3.3 12 V / LDC (`ioniq-12v-ldc`)

| Panel | Source |
|---|---|
| aux_12v banded by state | `bms/2101 aux_12v` grouped by `state` tag (active/charging/parked) |
| LDC on-voltage ceiling | `aux_12v` where `state='active'` (max / high percentile) |
| Parked resting-voltage | `aux_12v` where `state='parked'`, daily min/median |
| Derived signals | `derived/ldc_ok value`, `derived/aux12v_drop value` |

### 3.4 Tires (`ioniq-tires`) — depends on the §1.1 bot fix; then sparse/driving-gated; `last()`/`fill(previous)`

Blocked until the §1.1 tpms fix is merged and deployed and `derived/tire_*` is confirmed landing. After
the fix these signals refresh only when wheel pressures change (driving/rotation), so panels use
`last()`/`fill(previous)` and last-seen semantics.

| Panel | Source |
|---|---|
| Per-wheel psi_cold | `derived/tire_fl_psi_cold … tire_rr_psi_cold value` |
| Inter-wheel spread | `derived/tire_spread_psi value` |
| Per-wheel temp-excess | `derived/tire_fl_temp_excess … tire_rr_temp_excess value` |
| Over/under-inflation bands | Threshold coloring on psi_cold panels (36 psi cold placard reference) |

### 3.5 Pipeline health (`ioniq-pipeline`)

| Panel | Source |
|---|---|
| Samples/min per group | NOT one generic query — groups have disjoint field sets. Use **one target per group**, each `count()`-ing that group's always-populated field (e.g. `bms/2101 count(soc)`, `tpms count("fl.psi")`, `odometer count(km)`, `cells/1 count(cells)`, `derived/* count(value)`), GROUP BY `time(1m)` (populated while awake) |
| Per-group last-seen | `last(<field>)` + time per `"group"` |
| DTC history | `derived/dtc_count value` over time + `dtc/stored`,`dtc/pending` code list |
| ⚠️ Influx/Mongo storage growth | Not queryable from the `ioniq` measurement via InfluxQL. **v1:** cumulative sample-count over time as a proxy; true DB-size growth deferred (needs `_internal`/exporter). |

## 4. Delivery — PR granularity

Three PRs, in order (approved 2026-07-15):

- **PR0 — tpms bot bugfix (§1.1), ships first.** `docker/automations/bots/ioniq-tpms.js` nested-payload
  access + nested test fixtures. Standalone; unblocks the tire signals and recovers the dead tire alerts.
  Merged and deployed before the tires dashboard is validated.
- **PR1 — Overview + template + folder.** `ioniq-overview.json`, the "Ioniq EV" folder subdir, and the
  shared template (datasource, tag-based nav, tags, styling, time/refresh). Establishes and **locks the
  canonical shape**, reviewed carefully.
- **PR2 — the remaining 4** (`ioniq-battery`, `ioniq-12v-ldc`, `ioniq-tires`, `ioniq-pipeline`) cloning
  PR1's template. Branches from PR1's work so the template is not re-litigated.

PR0 is independent of PR1/PR2 (different files, different service) and can proceed in parallel with PR1;
only the `ioniq-tires` panel *validation* in PR2 depends on PR0 being merged+deployed. Because each
dashboard's nav lives inside its own JSON and nav is tag-based, splitting the dashboard PRs causes **no
shared-file conflicts**. If a trivial folder/provisioning conflict arises, rebase-resolve keeping all
content and have a fresh reviewer confirm.

## 5. Orchestration & review plan

Per the established recipe:

- Each PR (PR0, PR1, PR2) is driven by an **Opus orchestrator in its own git worktree** (background):
  spec-slice → plan → subagent build → independent review → PR, returning a GOOD-TO-MERGE verdict
  (+evidence) or FAILURE. PR0 (bot fix) follows the automations bot TDD pattern (`docker/automations`,
  `npm test`); PR1/PR2 are dashboard JSON.
- **All work via subagents**, model/effort matched: haiku for mechanical JSON checks, sonnet standard,
  opus for the template-design gate and final verdicts.
- **Independent fresh subagents at every review gate** (plan, per-dashboard, whole-branch, final PR
  review before merge). The author never reviews itself.
- **Escalate to the human only** for genuine product/judgment calls; otherwise proceed autonomously.
- **Commits:** selective staging only (never `git add .`); every commit body ends with the Claude-Session
  trailer.
- Each PR ends **OPEN** with its verdict. The human decides merges.

## 6. Validation (non-negotiable)

- Every panel query run **read-only against prod InfluxDB** (recipe below) and confirmed to return the
  expected field/tag names before finalizing.
- Dashboards provisioned into a **live Grafana**; each panel confirmed to render real data. Parsed signals
  are dense now; the cell-spread panel validated for query correctness against historical rest windows.
- **PR0 (tpms fix):** after merge+deploy, confirm `derived/tire_*` begins landing (query prod) and the
  Phase-3 tpms alert rules leave their dead/NoData state. The `ioniq-tires` panels are validated against
  that real post-fix data.
- Grafana logs show "finished to provision dashboards" with **no ioniq errors**; rendered **folder title
  verified** as "Ioniq EV".
- The validation Grafana target (local provisioned instance vs prod Grafana) is confirmed at plan time.

### Prod read-only query recipe

```
ssh routy 'cd ~/homy && AU=$(cat secrets.local/influxdb_admin_user) AP=$(cat secrets.local/influxdb_admin_password); \
  docker exec homy_influxdb_1 influx -database homy -username "$AU" -password "$AP" -execute "<InfluxQL>"'
```

Real creds live in `~/homy/secrets.local/*` (NOT `~/homy/secrets/*`). Prod is routy (`~/homy`,
docker-compose v1). Grafana provisioning is mounted → deploy = `git pull` + restart grafana.

## 7. Risks & open items

1. **PR1→PR2 sequencing.** PR2 depends on PR1's template; PR2 branches from PR1's work. Trivial
   folder/provisioning conflicts resolved keeping all, confirmed by a fresh reviewer.
2. **Tires depend on PR0.** The `ioniq-tires` panels carry no data until the §1.1 tpms fix is merged and
   deployed. Sequence PR2's tires validation after PR0; until then validate query shape only. The
   cell-spread panel is genuinely sparse (rest-only) and may look empty at a daytime review — validate its
   query against historical rest windows and note expected sparsity in the panel description.
3. **Flat/pinned signals** (`isolation_kohm` ~1000, `avail_chg`/`avail_dis` ~98) render as flat lines =
   healthy; note this in panel descriptions so a flat line isn't read as "no data".
4. **Three v1 reductions vs spec §7** (accepted): no per-module temp heatmap (JSON-string arrays), no
   lifetime round-trip efficiency (reset-looking counters → approximate windowed only), no true DB-size
   growth panel (not InfluxQL-queryable → sample-count proxy). Each needs future work (array-explosion
   bot; storage exporter) to reach full spec fidelity.
5. **Deferred Trips & charging** — out of scope; future segmentation-bot phase.

## 8. Acceptance criteria

- **PR0:** `ioniq-tpms` reads the nested payload; tests use nested fixtures and fail-before/pass-after;
  after merge+deploy, `derived/tire_*` lands in prod and the tpms alert rules recover.
- 5 JSON dashboards provisioned under a subdir rendering the **"Ioniq EV"** Grafana folder.
- Every panel query verified against prod field/tag names; `"group"` and dotted fields correctly quoted.
- Tag-based nav row present on all 5; nav auto-lists the family.
- Dense panels render live data; the cell-spread panel validated for correctness; tire panels render real
  data once PR0 is deployed.
- Grafana provisions with no ioniq errors.
- Three OPEN PRs (PR0, PR1, PR2) each carrying an independent GOOD-TO-MERGE verdict with evidence.
