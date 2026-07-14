# Ioniq `ioniq-12v-ldc` Bot — Design Spec

Status: draft for review · Date: 2026-07-14
Parent contract: [`2026-07-14-ioniq-monitoring-phase3-design.md`](2026-07-14-ioniq-monitoring-phase3-design.md) §4.2
Parent spec: [`../../ioniq-monitoring-alerting-spec.md`](../../ioniq-monitoring-alerting-spec.md) §4.2 / §5

## 1. Purpose

Turn the raw 12 V / LDC (DC-DC converter) telemetry on `ioniq/parsed/bms/2101` into two clean numeric
signals Grafana can threshold trivially:

- `derived/ldc_ok` (0/1) — is the LDC actually charging the 12 V battery when it should be?
- `derived/aux12v_drop` (0/1) — did the 12 V rail just sag abnormally?

The hard part is **not false-alarming on normal behaviour**: under heavy traction the LDC de-prioritises
12 V charging (load priority), so `aux_12v` legitimately floats down to ~12.8–13.0 V. That is NOT a
fault. The bot suppresses the low-voltage judgement whenever HV load is high, and only calls it a fault
when the 12 V rail stays low *while HV load is low* (LDC has spare capacity and still isn't charging).

## 2. Prod-grounded data (read-only queries on routy, 2026-07-14)

`bms/2101` fields confirmed present with realistic values: `aux_12v` (V), `ignition` (0/1),
`hv_kw` (kW, +traction / −regen), `charging` (0/1), `soc`, `state` tag ∈ {active, charging, parked}.

Load-vs-voltage relationship (last 30 d, `group='bms/2101'`, `ignition=1`):

| load band (hv_kw) | aux_12v min | mean | max | n |
|---|---|---|---|---|
| `< 0.5` (clearly idle/coasting) | 12.1 | **13.69** | 14.7 | 505 |
| `0.5 – 1.0` | 12.9 | 13.40 | 14.7 | 150 |
| `1.0 – 2.0` | 12.8 | 13.39 | 14.7 | 200 |
| `2.0 – 3.0` | 12.8 | 13.42 | 14.7 | 91 |
| `> 3` (heavy traction) | 12.8 | **13.28** | 14.5 | 1045 |

`hv_kw` while `ignition=1`: min −53, max +57, mean 4.28 kW.
`ignition=1 AND hv_kw<1.0 AND aux_12v<13.2`: 106 samples / 30 d (scattered transients, not sustained runs).

**Interpretation:** `aux_12v` is only *clearly* high (mean 13.69) below **0.5 kW**; across the whole
0.5–3 kW band it already sits ~13.4 with excursions to 12.8, and under heavy traction it averages 13.28.
So the only load regime where a healthy LDC unambiguously holds the rail well above 13.2 V is `< 0.5 kW`.
The gating threshold is therefore set at **0.5 kW** (not 1.0), giving clean separation and a conservative,
false-positive-averse design. The 106 low-load-low-voltage samples over 30 d are scattered transients,
which the 60 s continuous-sustain requirement filters out (a healthy rail dips briefly but does not stay
< 13.2 for a full minute at idle).

## 3. Signal definitions

### Constants (all config-overridable)

| name | default | grounding |
|---|---|---|
| `inputTopic` | `ioniq/parsed/bms/2101` | umbrella §4.2 |
| `ldcOkTopic` | `ioniq/parsed/derived/ldc_ok` | §3 convention |
| `auxDropTopic` | `ioniq/parsed/derived/aux12v_drop` | §3 convention |
| `lowVoltThreshold` | `13.2` V | umbrella §4.2 |
| `lowHvKwThreshold` | `0.5` kW | only regime where healthy aux_12v is clearly > 13.2 (mean 13.69); see §2 |
| `lowLoadWindowMs` | `15000` | require load low for a sustained tail, not a single blip (§ review item 4) |
| `sustainMs` | `60000` | umbrella §4.2 (≥60 s) |
| `fastDropVolts` | `0.8` V | umbrella §4.2 |
| `fastDropWindowMs` | `5000` | umbrella §4.2 (within 5 s) |
| `slowDropRatePerMin` | `0.3` V/min | umbrella §4.2 |
| `slowDropMinSpanMs` | `30000` | need ≥30 s of history to estimate a per-minute rate |
| `auxDropHoldMs` | `60000` | latch a sag high so a 1 m `last()` Grafana poll reliably catches the pulse |
| `windowMaxAgeMs` | `65000` | covers both 60 s sustain + slow-drop lookback with margin |
| `windowMaxSamples` | `300` | bound persisted window growth |

### Clock

The window and all time math use **receipt time** (`Date.now()` at message arrival, stored as `rxTs`),
not the payload's `ts`. "Sustained ≥ 60 s" is a real-elapsed-time judgement and must not depend on the
logger's clock. The emitted payload still passes through the source `ts` (and `state`) per convention §3.
Tests drive this with Jest fake timers + `jest.setSystemTime`.

### Rolling window (persistedCache)

`persistedCache = { version: 1, default: { window: [], auxDropLatchUntil: 0 } }`. Each valid sample
appends `{ aux_12v, ignition, hv_kw, state, ts, rxTs }`. Pruned every sample by age
(`rxTs < now − windowMaxAgeMs`) and length (keep newest `windowMaxSamples`). Persisted so a restart
doesn't blind the detector for 60 s.

### `derived/ldc_ok` (published every valid sample)

Let `recent` = window samples with `rxTs ≥ now − sustainMs` (trailing 60 s) and `loadTail` = window
samples with `rxTs ≥ now − lowLoadWindowMs` (trailing 15 s).

`fault` is true iff ALL of:
1. **Coverage (two-part):** (a) the *full window's* oldest sample has `rxTs ≤ now − sustainMs` (we hold
   ≥ 60 s of history — preserves the exact 60 s floor), AND (b) the oldest sample *within* `recent` has
   `rxTs ≤ now − sustainMs + coverageToleranceMs` (the trailing 60 s is densely populated from near its
   start). (b) rejects a lone fresh sample that survived the 65 s max-age prune after a telemetry gap
   (e.g. cold-start after parking) — without it, a single bad sample would false-fault; (a) alone (the
   `window[0]` check) is insufficient for that reason, and checking `recent[0]` with no tolerance would
   only ever be true at an exact boundary. `coverageToleranceMs` default 5 s.
2. **Continuous ignition on:** every sample in `recent` has `ignition === 1`.
3. **Continuous low voltage:** `max(recent.aux_12v) < lowVoltThreshold` (⟺ every sample < 13.2 for the
   full 60 s).
4. **Sustained low HV load:** `loadTail` is non-empty and `max(loadTail.hv_kw) < lowHvKwThreshold`
   (⟺ HV load stayed below 0.5 kW for the whole trailing 15 s). This is a deliberate hardening of the
   umbrella's "a recent low-hv_kw sample": a single coast/regen blip inside otherwise-heavy traction must
   NOT trigger a fault (that low voltage is load-explained). Requiring a sustained low-load tail means the
   LDC has had ≥ 15 s of spare capacity and the rail still hasn't recovered above 13.2 V → genuine fault.

`value = fault ? 0 : 1`. Any ignition-off sample, any recovery ≥ 13.2, a purely-heavy-traction 60 s, or a
mere brief low-load blip all yield `1`.

### `derived/aux12v_drop` (published every valid sample)

Instantaneous sag detection:
- **Fast sag:** `prevMax` = `max(aux_12v)` over samples with `rxTs ∈ [now − fastDropWindowMs, now)`
  (excludes current). If `prevMax − currentAux ≥ fastDropVolts` → sag.
- **Slow parked drift:** only when the current sample's `state === 'parked'`. `ref` = oldest **parked**
  sample with `rxTs ≥ now − sustainMs` (scoped to parked samples so an `active→parked` transition doesn't
  mix a driving voltage into the rate). If `now − ref.rxTs ≥ slowDropMinSpanMs` and
  `(ref.aux_12v − currentAux) / ((now − ref.rxTs)/60000) ≥ slowDropRatePerMin` → sag.

**Latched output:** on any sag, set `auxDropLatchUntil = now + auxDropHoldMs`. Then
`value = (sag || now < auxDropLatchUntil) ? 1 : 0`. The latch holds the pulse high for 60 s so a
`SELECT last("value")` Grafana rule polling at 1 m cadence reliably catches an otherwise sub-5-s edge
(keeps the umbrella-mandated `last()` query; a bare non-latched pulse would be missed most of the time).
After the hold elapses with no new sag, the signal returns to 0 and the alert clears.

### Payload shape (both signals, convention §3)

```js
mqtt.publish(topic, { _type: 'ioniq', group: 'derived/<name>', state, ts, value })
```

`state`/`ts` pass through from the triggering sample. `_bot`/`_tz` are injected by the framework.

### Robustness

A sample is **valid** only if `aux_12v`, `ignition`, `hv_kw` are finite numbers. Null/partial payloads
(missing fields, non-numeric) are ignored — not added to the window, no emission. This prevents a
malformed sample from corrupting the window or emitting a spurious signal.

## 4. Grafana rules — `config/grafana/provisioning/alerting/ioniq-12v-ldc-alerts.yaml`

Clone the `ioniq-12v-alerts.yaml` shape. Two rules, folder `Ioniq EV`, group `interval: 1m`, datasource
UID `P3C6603E967DC8568`, `classic_conditions` only, explicit `time >= now() - <window>` bound,
`noDataState: OK`, `execErrState: Alerting`, labels `severity/device: ioniq/subsystem: 12v`, `🚗` prefix,
static annotation text, full `__expr__` node model.

- `🚗 Ioniq LDC Not Charging` — `SELECT last("value") FROM "ioniq" WHERE "group"='derived/ldc_ok' AND
  time >= now() - 10m`; evaluator `lt [1]`; `for: 60s`; severity warning. (The `for: 60s` per umbrella
  §4.2 double-debounces on top of the bot's internal 60 s sustain — intentional extra safety for a
  low-frequency, high-annoyance alert; total latency ≈ bot 60 s + Grafana 60 s + poll, acceptable.)
- `🚗 Ioniq 12V Sag` — `SELECT last("value") FROM "ioniq" WHERE "group"='derived/aux12v_drop' AND time
  >= now() - 10m`; evaluator `gt [0]`; `for: 0s`; severity warning. Relies on the bot-side 60 s latch
  (above) so `last()` catches the pulse.

🚗 appears in both `title` and `summary` per umbrella §5.

**Scope note:** neither signal covers `state === 'charging'` (ignition off there, so `ldc_ok`'s gate
never applies; `aux12v_drop`'s slow branch is parked-only). Grid charging holds `aux_12v` at ~14.4 V
(confirmed in prod), so there is nothing to detect in that state. `ldc_ok` emits `1` throughout charging.

## 5. Deliverables

- `docker/automations/bots/ioniq-12v-ldc.js` + `.test.js` (TDD).
- Register `ioniq12vLdc` in `config/automations/config.js` after the `ioniqDtc` block.
- `config/grafana/provisioning/alerting/ioniq-12v-ldc-alerts.yaml`.
- `docs/influxdb-schema.md` — document `derived/ldc_ok` and `derived/aux12v_drop` (follow the
  `derived/dtc_count` precedent).

## 6. Test scenarios (TDD)

1. Subscribes to `inputTopic` only (exact match, no wildcard).
2. `ldc_ok = 1` under heavy traction low voltage: 60 s of `aux_12v` 12.9, `ignition=1`, `hv_kw=8` → **no
   fault** (load never low).
3. `ldc_ok = 0` sustained: 60 s of `aux_12v` 12.9, `ignition=1`, `hv_kw=0.2` → fault once ≥60 s covered
   and the trailing 15 s is all low-load.
4. `ldc_ok = 1` before 60 s elapses (coverage gate) even with fault-shaped samples.
5. `ldc_ok = 1` when a recovery sample ≥ 13.2 appears within the trailing 60 s.
6. `ldc_ok = 1` when ignition drops to 0 within the trailing 60 s.
7. **Single low-load blip in heavy traction does NOT fault:** 60 s of `hv_kw=8` @ 12.9 V with one
   `hv_kw=0.2` sample mid-window → `ldc_ok = 1` (loadTail not all-low-load). This is the review-item-4
   false-positive guard.
8. `ldc_ok = 1` when the last 15 s has a high-load sample even though 60 s of voltage < 13.2 (loadTail
   gate).
9. `aux12v_drop = 1` fast: 13.0 → 12.1 within 5 s. `= 0` when drop < 0.8 V.
10. `aux12v_drop = 1` slow parked: 12.8 → 12.4 over 60 s while `state='parked'`. `= 0` for same drift
    while `active`.
11. **Slow-parked ref scoping:** an `active` sample immediately before parking does not corrupt the drift
    rate right after the `active→parked` transition.
12. `aux12v_drop` latch: after a fast sag the signal stays `1` across subsequent non-sag samples for the
    hold window, then returns to `0`.
13. Null/partial payload ignored (no throw, no publish, window unchanged).
14. Payload shape: `_type:'ioniq'`, correct `group`, `state`/`ts` passthrough, numeric `value`.
15. Window bounded (age + length pruning).
