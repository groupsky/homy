# Ioniq EV — Monitoring & Alerting Specification

Status: draft for review · Target: `homy` repo (Grafana provisioning + automations bots) · Vehicle: 2017 Hyundai Ioniq Electric (28 kWh, 96S) · Data source: OBD logger telemetry in InfluxDB (`ioniq`) + MongoDB (`homy.ioniq`).

Thresholds below are derived from the 2026-07-14 baseline session and 2017 Ioniq Electric specs; every one is marked **baseline** (observed) or **spec** (rated limit) and is tunable once more history accrues. Nothing here modifies the logger — it consumes what the logger already publishes, plus a small set of computed "derived" signals.

---

## 0. Goals & non-goals

**Goals**
- Detect developing faults early (pack, 12 V, tires, DTCs) and notify over the existing Telegram channel with severity-appropriate urgency.
- Detect loss of telemetry (logger offline / stale data) *without* false-firing on the car's normal power-cycling.
- Provide operational dashboards for battery health, 12 V, tires, trips/charging, and pipeline health.

**Non-goals**
- No new notification transport (reuse `telegram-webhook` → `telegram-bridge`).
- No logger-side changes (tracked separately in `ioniq-logger` issues #5–#13).
- No alerting on signals that aren't yet decoded/queryable (those are prerequisites, §2, or logger work).

---

## 1. Architecture

```
logger ──MQTT──> mqtt-influx-ioniq ──> InfluxDB "ioniq"  ──> Grafana rules ─┐
       (ioniq/parsed/#)                (parsed only)                        │
                                                                            ├─> telegram-webhook ─> telegram-bridge ─> Telegram
automations bots (compute) ──MQTT──> ioniq/parsed/derived/* ──> InfluxDB ───┘
       (subscribe ioniq/parsed/#, ioniq/#)   (via same bridge)   Grafana rules
```

**Division of labour**
- **Grafana rules** own everything expressible as a threshold/staleness query over a single InfluxDB field: `isolation_kohm`, `soh`, `temp_max`, `cell_min_v`/`cell_max_v`, `aux_12v` (state-filtered), `avail_dis`, per-wheel pressure, and all data-liveness checks. Grafana also owns **all notification delivery, dedup, grouping, and silencing**.
- **Automations bots** own conditions Grafana/InfluxQL express poorly: **array logic** (DTC `codes[]`), **cross-field/cross-topic math** not in InfluxDB (96-cell rest spread, 12-sensor thermal spread, cold-normalized tire pressure, cross-wheel outliers), and **stateful/edge** logic (charge-stalled, SoC-at-park, LDC-not-charging). Each bot **reduces its condition to a clean numeric signal** published to `ioniq/parsed/derived/<name>` so it lands in InfluxDB and Grafana alerts on it with a trivial threshold. This keeps one notification path and one place to silence.
  - Exception: a bot MAY also flag immediately, but default is "bot computes → Grafana alerts" (worst-case added latency = Grafana eval interval, set to 1 m for the derived group).

---

## 2. Prerequisites (P0 — must land before alerts are trustworthy)

These are the gaps the analysis surfaced; alerts silently mislead without them.

| # | Prerequisite | Why it blocks alerting | Owner |
|---|---|---|---|
| P0-1 | **Promote needed raw signals to `parsed/` so they reach InfluxDB.** At minimum `bcm_b00e.charge_connector`, `obc.dc_*`. | Grafana can only see `ioniq/parsed/#`; raw groups are Mongo-only. Charge alerts need charge-connector + DC power. | logger #7 (& #5) |
| P0-2 | **Fix Mongo TTL retention.** Prod index `ttl__ts` targets a non-existent top-level `_ts`; 0/N docs match → retention never fires. Deploy fix #1382 (indexes `payload._ts`) to routy **and** manually `dropIndex("ttl__ts")` (createIndex won't remove the stale one). | Unbounded Mongo growth; not an alert per se but an ops must-fix. | homy ops |
| P0-3 | **Bound InfluxDB retention / downsample.** `autogen` RP = infinite (`duration 0s`); fast tier writes at ~2 Hz. Add a finite RP for raw high-rate groups + a CQ downsample (e.g. 1 m means) for dashboards/trends. | Unbounded Influx growth; long-range dashboards get slow. | homy ops |
| P0-4 | **Derived-signals convention.** Bots publish computed alert inputs to `ioniq/parsed/derived/<name>` with `{group:"derived/<name>", state, ts, value, …}` so the existing `mqtt-influx-ioniq` bridge writes them to measurement `ioniq`, tag `group=derived/<name>`. | Enables the "bot computes → Grafana alerts" pattern. | this spec |

> Note on split-brain (§for context): if the team prefers not to promote raw groups, an alternative is a second `mqtt-influx` bridge on `ioniq/raw/#`, but promoting the specific decoded fields (P0-1) is cleaner and already ticketed.

---

## 3. Severity model & notification routing

Three severities on a `severity` label, plus a `device: ioniq` label on every rule.

| Severity | Meaning | Examples | Delivery target |
|---|---|---|---|
| `critical` | Safety / imminent immobilisation / active fault | HV isolation low, cell over/under-V, pack over-temp, **any DTC**, 12 V critically low | Immediate, short repeat |
| `warning` | Developing problem, act within days | rising cell spread, SoH step, tire low, LDC not charging, charge stalled, low SoC at park, **logger offline (unexpected)** | Grouped, medium repeat |
| `info` | FYI / trend / hygiene | reduced-rate AC charge, connectivity flapping, module thermal spread nudging up | Digest, long repeat |

**Notification policy** (`config/grafana/provisioning/alerting/notification-policies.yaml`) — replace the single flat route with nested routes matched on `severity`, all still terminating at `telegram-webhook`:

```yaml
policies:
  - orgId: 1
    receiver: telegram-webhook
    group_by: [grafana_folder, alertname]
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
    routes:
      - receiver: telegram-webhook
        matchers: ['severity = critical']
        group_wait: 10s
        group_interval: 1m
        repeat_interval: 1h        # nag until acknowledged/resolved
      - receiver: telegram-webhook
        matchers: ['severity = warning']
        group_wait: 1m
        group_interval: 5m
        repeat_interval: 12h
      - receiver: telegram-webhook
        matchers: ['severity = info']
        group_wait: 5m
        group_interval: 30m
        repeat_interval: 24h
```

**Optional dedicated channel:** to separate car alerts from house alerts, add a second contact point `telegram-webhook-ioniq` (same `telegram-bridge` webhook, distinct `title:` e.g. "🚗 Ioniq Alert"; if a different Telegram chat is wanted, `telegram-bridge` must support a per-webhook chat id — verify before relying on it) and point the three routes above at it. Default for v1: reuse `telegram-webhook` with the `🚗` title prefix in each rule's `summary`.

---

## 4. Alert catalog

Columns: **Signal/source** · **Condition** · **Threshold** (baseline/spec) · **Sev** · **`for:`** · **Platform**. All Grafana queries use `classic_conditions` + explicit `WHERE time >= now() - <window>` (per repo Grafana rules; no `$timeFilter`). `group`/dotted fields are double-quoted; string literals single-quoted.

### 4.1 HV traction battery / BMS

| Signal | Condition | Threshold | Sev | for | Platform |
|---|---|---|---|---|---|
| HV isolation `isolation_kohm` (bms/2101) | value low (normally pinned 1000) | `<500` / `<100` (spec: ≥100 Ω/V min) | warning / **critical** | 10m | Grafana |
| Min cell `cell_min_v` (bms/2101) | under-voltage | `<3.0` warn / `<2.5` crit (spec NMC) | warning / **critical** | 1m | Grafana |
| Max cell `cell_max_v` (bms/2101) | over-voltage | `>4.15` (spec) | **critical** | 1m | Grafana |
| Pack temp `temp_max` (bms/2101) | over-temp | `>45` warn / `>55` crit (spec) | warning / **critical** | 5m | Grafana |
| SoH `soh` (bms/2105) | capacity fade | drop `>2%` from 30-day baseline warn; `<85%` crit | warning / **critical** | 1h | Grafana (baseline via subquery or bot) |
| Available discharge `avail_dis` (bms/2101) | BMS derate | `<70 kW` while `soc>30` (baseline 98) | warning | 15m | Grafana |
| **Rest cell spread** (96 cells, `cells/1|33|65`) | imbalance at rest | `>50 mV` warn / `>100 mV` crit (baseline 20 mV); **state≠active** | warning / **critical** | 10m | **Bot** `ioniq-cell-health` → `derived/cell_spread_mv` |
| **Module thermal spread** (12 sensors, bms/2101+2105) | hot module/coolant | `>8 °C` warn / `>15 °C` crit (baseline 2 °C) | warning / **critical** | 10m | **Bot** → `derived/module_temp_spread_c` |

Notes: SoH baseline — simplest v1 is a static `<98%` step + `<85%` crit; a rolling baseline needs a bot or a CQ. `cell_v_dev` field is deadbanded to 0 — **do not** alert on it; compute spread from the arrays.

### 4.2 Auxiliary 12 V / LDC

| Signal | Condition | Threshold | Sev | for | Platform |
|---|---|---|---|---|---|
| `aux_12v`, `state='parked'` | dying 12 V at rest | `<12.2` warn / `<11.8` crit | warning / **critical** | 30s (sustained) | Grafana (state tag filter) |
| `aux_12v` vs ignition/load | **LDC not charging** | `max(aux_12v) < 13.2 V` while `ignition=1` and a recent low-`hv_kw` sample, ≥60 s | warning | 60s | **Bot** `ioniq-12v-ldc` → `derived/ldc_ok` (0/1) |
| `aux_12v` fast delta | sag / shorted cell | drop `≥0.8 V / 5 s`, or `≥0.3 V/min` while parked | warning | — | **Bot** → `derived/aux12v_drop` |

Suppress "low voltage" firing while `hv_kw` is high — 12.9 V float under heavy traction is normal LDC load-priority, not a fault (the bot encodes this).

### 4.3 Tires (TPMS)

Cold-normalize each wheel to 15 °C before thresholding: `psi_cold = psi − 0.18·(temp − 15)`. TPMS only refreshes on wheel rotation, so evaluate on **fresh, `state=active` samples only** (dedupe parked duplicates).

| Signal | Condition | Threshold | Sev | for | Platform |
|---|---|---|---|---|---|
| Per-wheel `psi_cold` | under-inflation | `<30` warn / `<26` crit (placard 36; no spare → stranding risk) | warning / **critical** | — | **Bot** `ioniq-tpms` → `derived/tire_<w>_psi_cold` (+ Grafana threshold) |
| Inter-wheel `psi_cold` | developing imbalance/leak | max−min `>3 psi` (baseline 1.2) | warning | — | **Bot** → `derived/tire_spread_psi` |
| Per-wheel temp | brake drag / bearing | wheel `> others_mean + 8 °C`, ≥2 samples, active | warning | — | **Bot** → `derived/tire_<w>_temp_excess` |
| Over-inflation `psi_cold` | hard ride/over-pressure | `>42 psi` | info | — | **Bot**/Grafana |
| TPMS freshness | dead sensor / gap | no changed TPMS value in `>72 h driving` | info | — | Grafana staleness |

### 4.4 Faults (DTC)

| Signal | Condition | Threshold | Sev | for | Platform |
|---|---|---|---|---|---|
| `dtc/stored.codes[]`, `dtc/pending.codes[]` | any DTC present | `codes.length > 0` (baseline empty) | **critical** | — | **Bot** `ioniq-dtc` → `derived/dtc_count`; Grafana `>0` |

The bot includes the actual code list in the derived payload so the Telegram message can name the code(s).

### 4.5 Connectivity / data liveness

The box legitimately powers off ~60 s after the car locks, so naive LWT-offline alerts are noise. Two-layer approach:

| Signal | Condition | Threshold | Sev | for | Platform |
|---|---|---|---|---|---|
| Fast-tier freshness `count(hv_v) FROM ioniq WHERE "group"='bms/2101'` | data gap **during a session** | count `<1` in 15 m window | warning | 15m | Grafana (count<1, long `for:`) |
| Prolonged silence | logger offline beyond any plausible park | count `<1` in 30 m | warning | 30m | Grafana |
| `ioniq/status` offline transitions | flapping BLE/OBD | `≥3` offline transitions / rolling 1 h | info | — | Grafana count on status, or **Bot** counter |

Keying: use ingest `time` (Influx) / `_ts` (Mongo) for liveness — the LWT payload's own `ts` is stale (buffered). Consider gating the offline alert with a "car recently active" condition so it only fires when telemetry *should* be flowing.

### 4.6 Usage / charging

| Signal | Condition | Threshold | Sev | for | Platform |
|---|---|---|---|---|---|
| SoC at active→parked edge | low charge, get-home risk | `soc < 30%` at park | warning | — | **Bot** `ioniq-charge-guard` (state-edge) → `derived/soc_at_park` |
| Charge relay on, low power | **charge stalled/interrupted** | `charging=1 & |hv_kw|<0.3 kW` for `>10 m` | warning | 10m | **Bot** (timeout-emit style) → `derived/charge_stalled` |
| AC charge power | reduced-rate charge | `ac_port=1 & |hv_kw|<3 kW` sustained (this session was ~1 kW granny) | info | 10m | **Bot** → `derived/charge_reduced_rate` |
| SoC slope while parked | parasitic drain | `> 2%/day` across parked spans | warning | — | **Bot**/Grafana `derivative` |

Cross-reference: AC-side charge energy is available from the household **`charger` ORNO meter** — confirmed
live (measurement `xymd1`, see §10) — used for charge kWh/efficiency rather than decoding the OBC AC side;
the `ioniq-sessions` bot already does this for home charges (`bounds:meter`, §7).

---

## 5. Automations bots (new/reused)

All bots follow the repo pattern (`module.exports = (name, config) => ({ persistedCache, start })`), receive parsed objects from `mqtt.subscribe`, publish objects via `mqtt.publish`, and write only to `ioniq/parsed/derived/*`. Add unit tests (Jest, mocked MQTT) per repo standard.

| Bot | Type | Subscribes | Emits (`ioniq/parsed/derived/…`) | Core logic |
|---|---|---|---|---|
| `ioniq-cell-health` | new | `ioniq/parsed/cells/1\|33\|65`, `…/bms/2101`, `…/bms/2105` | `cell_spread_mv`, `module_temp_spread_c` | Reassemble 96-cell array (3 topics) → max−min (skip when `state='active'`); merge 12 module temps across two frames → max−min. |
| `ioniq-12v-ldc` | new | `…/bms/2101` | `ldc_ok` (0/1), `aux12v_drop` | Rolling window of `aux_12v`,`ignition`,`hv_kw`; flag LDC-not-charging under the low-load rule; compute drop rate. |
| `ioniq-charge-guard` | new | `…/bms/2101`, `…/bcm` (charge_connector), `…/obc` | `soc_at_park`, `charge_stalled`, `charge_reduced_rate` | State-edge SoC capture; stalled = relay on + low power (reuse `timeout-emit` semantics); reduced-rate classifier. |
| `ioniq-dtc` | new (thin) | `ioniq/parsed/dtc/#` | `dtc_count` (+ `codes`) | `codes.length`; pass code list through for the message. Could be a `mqtt-transform` config rather than bespoke code. |
| `ioniq-tpms` | new | `ioniq/parsed/tpms`, `…/ambient` | `tire_<w>_psi_cold`, `tire_spread_psi`, `tire_<w>_temp_excess` | Cold-normalize; dedupe non-active/frozen; cross-wheel outliers. |

Wire them in `config/automations/config.js` alongside existing bots. Where a generic bot fits (`timeout-emit` for charge-stalled, `stateful-counter`/`mqtt-transform` for DTC), prefer configuration over new code.

---

## 6. Grafana implementation

- **Folder:** new `Ioniq EV` folder for all rules (drives `group_by: grafana_folder`).
- **Datasource UID:** `P3C6603E967DC8568` (InfluxDB v1, db `homy`).
- **Contact point:** `telegram-webhook` (existing) — no change needed for v1.
- **Rule files:** one YAML per domain under `config/grafana/provisioning/alerting/`, mirroring existing naming:
  - `ioniq-battery-alerts.yaml`, `ioniq-12v-alerts.yaml`, `ioniq-tpms-alerts.yaml`, `ioniq-dtc-alerts.yaml`, `ioniq-connectivity-alerts.yaml`, `ioniq-usage-alerts.yaml`.
- **Rule template** (clone of `sunseeker-connectivity-alerts.yaml`; the canonical working shape in this repo):

```yaml
- uid: ioniq-isolation-low
  title: "🚗 Ioniq HV Isolation Low"
  condition: A
  data:
    - refId: iso
      relativeTimeRange: { from: 600, to: 0 }
      datasourceUid: P3C6603E967DC8568
      model:
        query: |
          SELECT last("isolation_kohm") FROM "ioniq"
          WHERE "group"='bms/2101' AND time >= now() - 10m
        rawQuery: true
        resultFormat: time_series
    - refId: A
      datasourceUid: __expr__
      model:
        type: classic_conditions
        conditions:
          - evaluator: { type: lt, params: [500] }
            operator: { type: and }
            query: { params: [iso] }
            reducer: { type: last }
            type: query
        expression: iso
  noDataState: NoData
  execErrState: Alerting
  for: 10m
  labels: { severity: warning, device: ioniq, subsystem: battery }
  annotations:
    summary: "🚗 HV isolation resistance dropped below 500 kΩ"
    description: "Possible HV leak to chassis. Investigate before driving if it keeps falling."
```

**Repo-specific gotchas (baked in):**
- Use `classic_conditions`, never `threshold`; always explicit `WHERE time >= now() - <window>`; never `$timeFilter` (Grafana 9.5+ provisioned-alert bug).
- `classic_conditions` **drops `GROUP BY` tag labels** — if a rule ever groups by a tag and needs `{{ $labels.x }}`, use a `reduce`→`threshold` expression pair instead (see repo memory). For Ioniq most rules are single-series (one car), so this mainly matters if per-wheel/per-cell rules are ever expressed with `GROUP BY`.
- Deleting a provisioned rule requires a `delete-*.yaml` `deleteRules:` file (can't delete via UI).

---

## 7. Dashboards

New `Ioniq EV` dashboard family (JSON under `config/grafana/dashboards/`, provider already configured). Follow repo dashboard standards (stat/timeseries/gauge, 24 h overview / 6 h detail defaults).

| Dashboard | Panels |
|---|---|
| **Overview** | SoC + SoC_display gauge; pack V/A/kW; 12 V (color-banded); current DTC status; connectivity/last-seen stat; odometer; current tire pressures (4 stats); active alert list. |
| **Battery health** | SoC & SoH trend; cell max/min/spread (derived) timeseries; 12-module temp heatmap + spread; isolation; available charge/discharge envelope; cumulative Ah/kWh + derived usable-Ah and round-trip efficiency. |
| **12 V / LDC** | `aux_12v` timeseries banded by state; per-drive LDC on-voltage ceiling; parked resting-voltage trend (daily min/median); derived `ldc_ok`. |
| **Tires** | Per-wheel `psi_cold` trend; inter-wheel spread; per-wheel temp vs ambient; over/under-inflation bands. |
| **Trips & charging** | State timeline (active/charging/parked); per-trip distance/energy/efficiency (kWh/100 km); regen recovery %; charge sessions (AC/DC, kWh, avg power); SoC-at-park distribution; charger-meter AC power overlay (if live). |

> **Data source (2026-07-18):** this dashboard was previously **deferred** — per-trip distance/energy/
> efficiency, regen-recovery %, and charge-session breakdowns need trip/charge **session boundaries** that
> no bot emitted, and pure-InfluxQL session math is fragile and unvalidatable
> (`docs/superpowers/specs/2026-07-15-ioniq-monitoring-phase4-dashboards-design.md` §1). It is now unblocked:
> the **`ioniq-sessions`** automations bot segments the telemetry stream into `trip`/`charge`/`park` sessions
> and the **`ioniq_sessions`** InfluxDB measurement (tag `kind`, back-dated `start_ts`) is this dashboard's
> data source — see
> `docs/superpowers/specs/2026-07-18-ioniq-session-segmentation-bot-design.md` and
> `docs/influxdb-schema.md` (`ioniq_sessions` measurement). Building the dashboard panels themselves remains
> a separate, not-yet-started deliverable (design spec §1, §9 PR3).
| **Pipeline health** | Samples/min per group; per-group last-seen; connectivity transitions; Influx/Mongo growth; DTC history. |

Link the family with a dashboard-links row (overview ↔ detail), per repo navigation standard.

---

## 8. Runbook (per-alert response)

Each rule's `annotations.description` should carry the first action. Summary table:

| Alert | First response |
|---|---|
| HV isolation low | Don't fast-charge; if trending down, book HV inspection (coolant/harness). |
| Cell over/under-V, pack over-temp | Stop charging/driving; read full DTC + cell dump; service. |
| Rising cell spread | Note outlier cell index; monitor; balance/service if >100 mV persists. |
| SoH step / low | Log; compare to warranty threshold (Ioniq ~ replaceable <65–70%). |
| 12 V low at rest | Charge/replace 12 V before next lock cycle; it strands the car. |
| LDC not charging | DC-DC converter suspect; verify with a drive; service if repeats. |
| Tire low / outlier | Top up (FR first per baseline); if it recurs, inspect for leak/nail. |
| Tire temp outlier | Check for dragging brake / seizing bearing on that corner. |
| **DTC present** | Read code(s) from the message; decode; act by code. |
| Logger offline (unexpected) | Check box power/BLE; distinguish from normal post-lock power-off. |
| Charge stalled / reduced-rate | Check cable/EVSE; confirm target SoC reached. |
| Low SoC at park | Plug in; charge for next trip. |

---

## 9. Rollout phases

1. **P0 prerequisites** (§2): promote raw→parsed (#7/#5), fix retention (P0-2/3), establish `derived/*` convention.
2. **Grafana-native alerts** (§4.1 non-derived, §4.2 parked-12 V, §4.5 connectivity, §4.4 DTC via a thin bot): highest value, lowest effort. Ship the `Ioniq EV` folder + notification routing (§3).
3. **Computation bots** (§5) + their derived-signal Grafana rules: cell spread, thermal spread, LDC, tires, charge-guard.
4. **Dashboards** (§7).
5. **Tune** thresholds against 2–4 weeks of real history; convert static SoH/parked-drain baselines to rolling ones.

> **Implementation status (2026-07-14):** Phase 2 is implemented on branch
> `feat/ioniq-monitoring-phase2` — Grafana battery (§4.1 non-derived), parked-12 V (§4.2), and
> DTC (§4.4) alert rules; the `ioniq-dtc` bot (derived `dtc_count` + direct-flag); the `Ioniq EV`
> folder; and Ioniq-scoped notification routing (§3, scoped to `device = ioniq` rather than the
> house-wide reroute). Connectivity/liveness (§4.5) is deferred to phase 3: a `count()`-based
> Grafana rule cannot express it (empty window returns no row, not 0) and NoData would fire on
> every normal park, so it needs a session-aware bot. See
> `docs/superpowers/specs/2026-07-14-ioniq-monitoring-phase2-design.md`.

---

## 10. Open items / dependencies

- ~~Verify the `charger` ORNO meter is live.~~ **Resolved (2026-07-18):** it *is* live — verified over 609
  days (2024-11 → 2026-07) of continuous ~8 s-cadence data. The original query found nothing because it
  looked under `monitoring`/`charger`-named Influx tags/measurements; the meter actually writes to
  measurement **`xymd1`** (tags `device.name=charger`; fields `ap`=W instantaneous power, `act`=cumulative
  kWh), a naming mismatch, not a dead device. It has a 0 W idle baseline (99.98% of idle samples exactly
  0 W), three observed charging tiers (~1.2 / 1.9 / 2.6 kW), and no daytime other-load on the circuit —
  clean enough to bound home charges by a relative power threshold. Now used by the `ioniq-sessions` bot
  (design spec `docs/superpowers/specs/2026-07-18-ioniq-session-segmentation-bot-design.md` §3.3, §0.1) as
  the preferred `bounds:meter` source for AC-side charge energy/efficiency. (OVMS, which previously covered
  this, is dead as of ~2025-09-24.)
- **`brakes_on` is unreliable** (logger #9) — don't build braking alerts on it; use `brake_lamp`.
- **New signals unlock new alerts** once logger tickets land: motor/inverter over-temp (#5), cabin over-temp / preconditioning verify (#6), direct LDC current/temp (#8), body/security (door-left-unlocked, window-open) (#13).
- **Decide** dedicated vs shared Telegram channel (§3) before wide rollout.
- **Retention/downsampling numbers** (P0-3) to be chosen with the team (measurement growth rate × desired horizon).
```
