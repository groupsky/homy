# Ioniq EV Phase-4 Dashboards — Verified Build Brief (PR1 + PR2)

**Status:** verified ground truth, 2026-07-15. Companion to the approved spec
`docs/superpowers/specs/2026-07-15-ioniq-monitoring-phase4-dashboards-design.md`.

Everything below was **verified** — against prod InfluxDB (read-only), the repo, or the pinned
Grafana source at tag `v9.5.21`. **Do not re-litigate or re-derive these facts; do not guess past
them.** If you find something here to be wrong, say so loudly with evidence rather than silently
working around it.

---

## 1. Environment (verified)

| Fact | Value |
|---|---|
| Grafana version | **9.5.21** (`base-images/grafana/Dockerfile`, `docker/grafana/Dockerfile`) |
| Dashboard `schemaVersion` | **37** (all 4 existing dashboards) |
| Datasource | InfluxDB **v1 / InfluxQL** (never Flux, never SQL) |
| Datasource UID | **`P3C6603E967DC8568`** |
| Database / measurement | `homy` / `ioniq` |
| Provider config | `config/grafana/provisioning/dashboards/dashboards.yaml`: `foldersFromFilesStructure: true`, `allowUiUpdates: false`, `path: /var/lib/grafana/dashboards` |
| Alert folder title | **`Ioniq EV`** — verbatim `folder: Ioniq EV` in all 6 `config/grafana/provisioning/alerting/ioniq-*.yaml` |

`allowUiUpdates: false` ⇒ every dashboard is hand-authored JSON. Existing dashboards sit flat at
the dashboards root ⇒ they land in Grafana's **General** folder. A **subdirectory name becomes the
folder title**, which is the only mechanism available to produce the "Ioniq EV" folder.

## 2. Canonical dashboard shape (clone this)

Top-level keys, alphabetically ordered exactly as Grafana exports them (from `sunseeker-overview.json`):

```
annotations, description, editable, fiscalYearStartMonth, graphTooltip, id, links, liveNow,
panels, refresh, schemaVersion, style, tags, templating, time, timepicker, timezone, title,
uid, version, weekStart
```

with `id: null`, `editable: true`, `style: "dark"`, `schemaVersion: 37`, `templating: {"list": []}`,
`liveNow: false`, `graphTooltip: 0`, `fiscalYearStartMonth: 0`, `version: 1`, `weekStart: ""`,
`timezone: ""`. The standard `annotations.list` block (builtIn Annotations & Alerts) is copied verbatim.

**Datasource reference form — consistent everywhere, object form, never a bare string:**

```json
"datasource": { "type": "influxdb", "uid": "P3C6603E967DC8568" }
```

Used both at panel level and inside every `targets[]` entry.

**Target style — use "Style A" (raw InfluxQL string), which all 3 sunseeker dashboards use exclusively:**

```json
{
  "datasource": { "type": "influxdb", "uid": "P3C6603E967DC8568" },
  "query": "SELECT last(\"mode\") FROM \"sunseeker_mode\" WHERE $timeFilter",
  "rawQuery": true,
  "refId": "A"
}
```

Do **not** replicate `heatpump.json`'s builder-style targets (`select`/`groupBy`/`tags`/`measurement`
metadata). Style A is simpler and sufficient. `pluginVersion: "9.5.2"` appears per-panel in existing
files; it is cosmetic — either reuse it verbatim or omit it.

Panel types with in-repo precedent to clone: `stat`, `timeseries`, `bargauge`, `table`, `heatmap`
(`sunseeker-battery.json`). Read the real files for their verbatim `fieldConfig`/`options` blocks.

## 3. Deviations from existing files — deliberate, do not "fix" back

The spec **overrides** existing precedent on three points. These are intentional; a reviewer must not
flag them as inconsistencies:

1. **Tag-based navigation.** Existing sunseeker dashboards hardcode `/d/<uid>` URL links
   (`"type": "link"`). Zero dashboards in the repo use tag-based nav. The spec deliberately uses a
   dashboard-links row of `"type": "dashboards"` filtered to tag `ioniq`, so the family auto-populates
   as siblings land — no dead links, no cross-PR file edits. **This is the approved improvement.**
2. **Refresh `1m`.** The spec calls this the "repo standard"; it is **not** — the real files use
   sunseeker `30s`, heatpump `5s`. The spec's parenthetical is inaccurate, but `1m` remains the right
   call (the car sleeps; telemetry is ~0.5 s while awake and absent for hours otherwise) and the spec is
   approved. Use `1m`. This note exists so nobody "corrects" it to 30s citing precedent.
3. **Time ranges:** Overview `now-24h`, detail dashboards `now-6h` (per spec and
   `config/grafana/CLAUDE.md`). Note the real sunseeker files invert this (overview `now-6h`); follow the
   spec.

Tags on every dashboard: `["ioniq", "ev", "vehicle"]`.

## 4. Prod field verification (2026-07-15, read-only)

**Every field the spec's panels need exists and carries recent real data. Nothing is missing.**

| field | group | last value |
|---|---|---|
| soc | bms/2101 | 52 |
| hv_v / hv_a / hv_kw | bms/2101 | 351.7 / 3.1 / 1.09027 |
| aux_12v | bms/2101 | 13.5 |
| isolation_kohm | bms/2101 | 1000 (pinned ceiling = healthy) |
| avail_chg / avail_dis | bms/2101 | 98 / 98 (pinned) |
| cell_max_v / cell_min_v | bms/2101 | 3.66 / 3.66 |
| temp_max / temp_min | bms/2101 | 30 / 29 |
| cum_chg_ah / cum_dis_ah | bms/2101 | 30156.1 / 30118.2 |
| cum_in_kwh / cum_out_kwh | bms/2101 | 10915.8 / 10603.7 |
| soh / soc_display | bms/2105 | 100 / 54 |
| value | derived/dtc_count | 0 (healthy) |
| km | odometer | 174650 |
| "fl.psi" "fr.psi" "rl.psi" "rr.psi" | tpms | 37 / 35.4 / 35.8 / 36.2 |
| "fl.c" "fr.c" "rl.c" "rr.c" | tpms | 37 / 38 / 38 / 38 |

Tag keys: only **`group`** and **`state`**. `state` values: `active`, `charging`, `parked`.

### 4.1 TRAPS — these will silently corrupt panels

1. **`km` is overloaded across groups with different meanings AND scales.** `odometer`.`km` = 174650
   (cumulative total); `range_est`.`km` = ~145.6 (remaining range estimate). Same field key, same
   measurement. **Every `km` query MUST filter on `"group"`** or it blends a 174650-scale series with a
   146-scale series into one graph.
2. **`state` is BOTH a tag key and a field key** (`SHOW FIELD KEYS` lists a string `state`). `GROUP BY
   "state"` correctly uses the tag; a bare `SELECT "state"` may not do what you expect.
3. **`state` distribution is heavily skewed** (30 d, points carrying `soc`): `active` 5116 (~98.1%),
   `charging` 69 (~1.3%), `parked` **30 (~0.6%)**. Any panel filtered to `parked`/`charging` will look
   near-empty — **that is real data, not a bug**. This directly affects the spec §3.3 "parked
   resting-voltage" panel: say so in the panel description rather than letting a reviewer read it as
   broken.
4. **`derived/cell_spread_mv` has only 4 points all-time** (rest-only by design). Use
   `last()`/`fill(previous)`; never `count()`-based liveness.
5. **`count()` over an empty window returns NO row** while the car sleeps — never build liveness on it.
   Use `last()` + time.

### 4.2 Groups the spec did not mention (candidates, verify before use)

- **`range_est`** — carries exactly one populated field: **`km`** (~145.6, remaining range). Not `value`.
- **`vehicle`** — identity/health: `detected_id` (`ioniq-ae-28`), `mismatch` (false), `seq`. Low
  frequency (~1 h old vs ~11–16 min for BMS). Suitable for an identity/last-seen panel, not live
  telemetry. `charging`/`since_ms` came back empty on sampled rows — verify before using.

### 4.3 Working InfluxQL for dotted fields (copy verbatim)

```sql
SELECT last("fl.psi") FROM "ioniq" WHERE "group"='tpms'
```

Quote the **entire** dotted identifier as one unit (`"fl.psi"` — not `fl."psi"`, not bare `fl.psi`
which parses as measurement-dot-field). Single-quote tag values (`'tpms'`). Double-quote `"group"`
(reserved word).

Note the flat `fl.psi` fields in InfluxDB are produced by the **mqtt-influx converter flattening the
nested MQTT payload at write time**. They are real and queryable **today** — the Overview's tire stats
therefore work independently of PR0. Only `derived/tire_*` (the ioniq-tires dashboard, PR2) depends on
the PR0 bot fix.

## 5. The two panel types with no in-repo precedent (verified against Grafana source @ tag v9.5.21)

Repo-wide grep: **zero** usage of `gauge` or `alertlist`. Authored from the pinned source, not docs
(grafana.com's v9.5 doc tree 404s).

### 5.1 `gauge` (Overview SoC)

```json
{
  "type": "gauge",
  "options": {
    "reduceOptions": { "calcs": ["lastNotNull"], "fields": "", "values": false },
    "orientation": "auto",
    "showThresholdLabels": false,
    "showThresholdMarkers": true
  },
  "fieldConfig": {
    "defaults": {
      "min": 0, "max": 100, "unit": "percent", "decimals": 0, "mappings": [],
      "color": { "mode": "thresholds" },
      "thresholds": { "mode": "absolute", "steps": [
        { "color": "red", "value": null }, { "color": "orange", "value": 20 }, { "color": "green", "value": 50 }
      ] }
    },
    "overrides": []
  }
}
```

- `unit: "percent"` is correct for 0–100 values (`percentunit` is for 0.0–1.0). SoC is 0–100.
- `text` (`titleSize`/`valueSize`) exists in 9.5.21 but is optional — omit.
- **`minVizWidth` / `minVizHeight` / `sizing` do NOT exist in 9.5.21** (they arrived later). Including
  them is an error.

### 5.2 `alertlist` (Overview active alerts) — read this carefully

Grafana 9.5.21 swaps the whole plugin at registration:
`config.unifiedAlertingEnabled ? unifiedAlertList : alertList`. Unified alerting is **on by default**
when neither `[alerting].enabled` nor `[unified_alerting].enabled` is set (both unset in
`conf/defaults.ini`). Our rules are YAML-provisioned unified rules ⇒ the **`UnifiedAlertListOptions`**
schema applies, **not** the legacy one. No option is needed to "turn on" unified — the swap is at the
plugin level.

```json
{
  "type": "alertlist",
  "title": "Active Alerts",
  "options": {
    "viewMode": "list",
    "groupMode": "default",
    "groupBy": [],
    "maxItems": 20,
    "sortOrder": 3,
    "dashboardAlerts": false,
    "alertName": "",
    "alertInstanceLabelFilter": "",
    "folder": { "title": "Ioniq EV" },
    "stateFilter": { "firing": true, "pending": true, "noData": false, "normal": false, "error": true }
  }
}
```

- **Folder filtering is BY TITLE, not by numeric id.** The filter logic reads only `.title`:
  `filteredRules.filter(rule => rule.namespaceName === options.folder.title)`. `id`/`uid` are never
  consulted for filtering. So `"folder": {"title": "Ioniq EV"}` is stable across environments and
  independent of the provisioned folder's DB id — exactly what hand-authored JSON needs. (The legacy
  schema's numeric `folderId` is dead code here.)
- `sortOrder` is a **numeric enum**: `AlphaAsc=1, AlphaDesc=2, Importance=3, TimeAsc=4, TimeDesc=5`.
- `stateFilter` keys are exactly `firing, pending, noData, normal, error` (do not author the legacy
  `inactive`).
- The panel sets `skipDataQuery: true` ⇒ **needs no panel `datasource` and no `targets`**.
  `options.datasource` is a different thing (an optional rule-source **name** filter; the
  Grafana-managed sentinel is the literal `"-- Grafana --"`).

## 6. Validation target — DECIDED and feasibility-verified

**Local Grafana 9.5.21 container + SSH tunnel to prod InfluxDB using the READ-ONLY user.** This renders
real prod data in a live Grafana while touching prod read-only. **Do not provision an unmerged branch
onto the prod Grafana.**

Verified working end-to-end on 2026-07-15:

```bash
IP=$(ssh routy 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}" homy_influxdb_1' | awk '{print $1}')
ssh -f -N -L 18086:$IP:8086 routy          # influx is NOT port-published; it is on the internal
                                            # `automation` docker network, reachable via container IP
curl -s "http://127.0.0.1:18086/ping" -o /dev/null -w "%{code}\n"   # -> 204
```

A read-only query through the tunnel returned `soc=52 @ 2026-07-15T18:32:26Z`, matching §4. Credentials:
`~/homy/secrets.local/influxdb_read_user` and `influxdb_read_user_password` on routy (**real creds live
in `secrets.local/`, NOT `secrets/`**).

The datasource provisioning (`config/grafana/provisioning/datasources/influxdb.yaml`) is env-var driven
(`$INFLUXDB_URL`, `$INFLUXDB_DATABASE`, `$INFLUXDB_USER`, `$INFLUXDB_USER_PASSWORD`), so point a local
Grafana at the tunnel by setting those. Mount `config/grafana/dashboards` at
`/var/lib/grafana/dashboards` and the provisioning dir, to exercise the **real** provider config
(`foldersFromFilesStructure`) rather than a hand-made substitute.

Tear the tunnel down when finished. Read-only queries only — never DROP/DELETE/INSERT/ALTER/CREATE.

### Required evidence
- Grafana log shows `finished to provision dashboards` with **no ioniq errors**.
- The rendered **folder title reads exactly "Ioniq EV"** (this is the whole point of the subdir; a
  spaced directory name may or may not render as intended — **verify it, do not assume**, and adjust +
  re-verify if wrong).
- Each panel confirmed rendering real data (screenshot or API-read panel data). Sparse panels
  (cell-spread, parked-state) validated against historical rest windows, and their expected sparsity
  noted in the panel `description`.
- Flat/pinned signals (`isolation_kohm` ~1000, `avail_chg`/`avail_dis` ~98) render as flat lines =
  healthy; note that in panel descriptions so a flat line isn't misread as "no data".
