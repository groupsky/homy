# Ioniq TPMS bot — per-bot design spec

Status: draft · Date: 2026-07-14 · Parent contract:
[`2026-07-14-ioniq-monitoring-phase3-design.md`](2026-07-14-ioniq-monitoring-phase3-design.md) (§4.3)
Parent spec: [`docs/ioniq-monitoring-alerting-spec.md`](../../ioniq-monitoring-alerting-spec.md)

## 1. Goal

Reduce the Ioniq's per-wheel tire-pressure telemetry to clean numeric alert inputs on
`ioniq/parsed/derived/*` that Grafana thresholds trivially. Tire pressure varies with temperature
(~0.18 psi/°C), so a raw psi reading is not comparable to the 36 psi cold placard. This bot
temperature-compensates each wheel to a 15 °C reference and derives cross-wheel signals (spread,
per-wheel temperature excess) that a single InfluxQL threshold cannot express.

## 2. Prod verification (2026-07-14, read-only on routy)

Confirmed against prod InfluxDB (`homy`.`ioniq`):
- `tpms` carries dotted fields `fl.psi`,`fl.c`,`fr.psi`,`fr.c`,`rl.psi`,`rl.c`,`rr.psi`,`rr.c`
  (`.c` = °C). Realistic sample: `fl.psi=36.6, fl.c=35`. Cold-normal → `36.6 − 0.18·(35−15) = 33.0`.
- `state` values seen for `tpms`: `active` (104 samples/30d), `charging` (6), `parked` (5).
  TPMS refreshes on wheel rotation → the overwhelming majority of fresh data is `active`.
- Parked/charging rows are **frozen duplicates** (e.g. `fl.psi=36.2` repeated across timestamps) —
  the sensor holds its last reading, so identical consecutive samples must be de-duplicated.
- `ambient` carries temp field `c` (e.g. `25`, `26.5`).

## 3. Subscriptions

Exact-match topics (no wildcards), config-overridable:
- `tpmsTopic` = `ioniq/parsed/tpms`
- `ambientTopic` = `ioniq/parsed/ambient`

The framework JSON-parses payloads → the bot receives JS objects. The `ambient` handler only caches
the latest ambient temp; it never emits. The `tpms` handler does all evaluation.

## 4. Logic

### 4.1 Gating (evaluate only fresh, moving samples)
- Skip any `tpms` sample whose `state !== 'active'`. (Parked/charging TPMS is stale by definition.)
- Dedupe: hold the last raw `{fl.psi,fl.c,...,rr.psi,rr.c}` tuple in `persistedCache.lastRaw`. If the
  incoming raw tuple is identical (stable-stringify) to the previous one, skip processing entirely
  (frozen reading). On a raw tuple that differs from `lastRaw`, set `lastRaw` to it **and then**
  compute/emit — so `lastRaw` tracks the sensor's raw state even for a changed-but-unusable sample
  (e.g. all psi missing, which then simply emits nothing). This guarantees each distinct raw reading
  is processed at most once.

### 4.2 Cold normalization
Per wheel `w ∈ {fl,fr,rl,rr}`:
```
comp_temp_w = (w.c is a finite number) ? w.c : ambient.c    # ambient fallback for compensation
psi_cold_w  = w.psi − 0.18 · (comp_temp_w − 15)
```
Ambient fallback applies **only** to `psi_cold` (any reasonable reference beats none). The
`temp_excess` signal below uses the wheel's **own measured** temperature only (no ambient
fallback) — substituting ambient for a dead-sensor wheel would fabricate a meaningless excess.
If a wheel's `psi` is missing/non-finite, that wheel produces no `psi_cold` signal and is excluded
from the `tire_spread_psi` calculation. (This does **not** exclude the wheel from `temp_excess`: a
wheel with a valid temp but a dead pressure cell must still count toward the temperature comparison —
see §4.3.) If a wheel temp is missing AND no ambient temp is cached, that wheel cannot be
cold-compensated → it emits no `psi_cold`.

### 4.3 Emitted signals (per fresh, changed, active sample)
All via `mqtt.publish(topic, { _type:'ioniq', group:'derived/<name>', state, ts, value:<number>, ... })`.
`state` and `ts` pass through from the `tpms` payload.

- `derived/tire_fl_psi_cold`, `…_fr_…`, `…_rl_…`, `…_rr_…` — one per wheel that has a valid
  `psi_cold`. `value` = rounded `psi_cold` (2 dp). Extra field: `psi` (raw), `temp` (used temp).
- `derived/tire_spread_psi` — `max − min` over all wheels that produced a `psi_cold`. Requires ≥ 2
  valid wheels; otherwise not emitted. `value` = rounded spread (2 dp).
- `derived/tire_fl_temp_excess` … `_rr_…` — per wheel with a finite **own measured** temp:
  `value` = `own_temp_w − mean(own temps of the OTHER wheels that have a finite own temp)`, °C,
  rounded 2 dp. Requires ≥ 1 other wheel with a finite own temp; otherwise not emitted. A wheel
  whose own temp is missing does not participate even if ambient is cached.
  (This is the raw °C excess, not a 0/1 flag — keeps the Grafana threshold trivial: `> 8`.)

Numeric rounding uses `Math.round(x*100)/100` to avoid float noise polluting InfluxDB.

## 5. persistedCache
```
version: 1
default: { lastRaw: null }
```
`lastRaw` = the last emitted raw tuple as a plain object (`{ 'fl.psi':.., 'fl.c':.., ... }`), used only
for frozen-duplicate detection across restarts. Cache is non-critical: a reset at worst re-emits one
already-current sample, which is harmless.

## 6. Grafana rules — `config/grafana/provisioning/alerting/ioniq-tpms-alerts.yaml`

Clone the phase-2 shape. `classic_conditions` only; query
`SELECT last("value") FROM "ioniq" WHERE "group"='derived/<name>' AND time >= now() - 6h`
(6 h window — TPMS is sparse but a fresh drive lands data; `noDataState: OK` so a parked car is silent).
Rationale for 6 h (not longer): the derived signals are only trustworthy for the most recent drive;
after the car sleeps for hours the reading is stale and would false-alarm on a cooled tire, so we
deliberately let it age out (the driver's own dash TPMS light is the primary safety indicator; this
alert is a backstop that fires while data is fresh). Every rule MUST set both `noDataState: OK` and
`execErrState: Alerting`. Every `__expr__` node: `datasource:{type:__expr__,uid:__expr__}`,
`intervalMs:1000`, `maxDataPoints:43200`, `refId:A`, `hide:false`. Datasource UID `P3C6603E967DC8568`,
folder `Ioniq EV`, group `interval: 1m`. `🚗` prefix; labels `severity`/`device: ioniq`/`subsystem: tpms`.
Static annotations. Rules (17 total):
- per-wheel `psi_cold < 30` **warning** (4) and `< 26` **critical** (4).
- `tire_spread_psi > 3` **warning** (1).
- per-wheel `temp_excess > 8` **warning** (4).
- per-wheel over-inflation `psi_cold > 42` **info** (4).

`for:` — `0s` (TPMS is already sparse and gated to fresh drives; no need to sustain). Note: umbrella §5
asks group `interval` (1m) ≤ each rule's `for`; `for: 0s` means fire-immediately in Grafana and is
explicitly sanctioned by the umbrella (§4.2 `aux12v_drop` uses `for: 0s`), so this is intentional.

## 7. Files delivered
- `docker/automations/bots/ioniq-tpms.js` + `.test.js`
- `config/automations/config.js` — `ioniqTpms` registration appended near `ioniqDtc`
- `config/grafana/provisioning/alerting/ioniq-tpms-alerts.yaml`
- `docs/influxdb-schema.md` — document the new `derived/tire_*` groups

## 8. Test scenarios (TDD)
- subscribes to both configured topics
- cold-normalization math per wheel using own `.c`
- ambient fallback when a wheel temp missing
- active-only gating: `parked`/`charging` samples emit nothing
- frozen-duplicate dedupe: identical consecutive active sample emits nothing; a changed one emits
- four per-wheel `psi_cold` signals, correct topics + payload shape (`_type`, group, state, ts, value)
- spread = max−min of cold pressures; needs ≥2 wheels
- temp_excess per wheel = wheel − mean(other three); each wheel independently
- missing-wheel / partial payload: absent psi → no signal for that wheel, others still emit
- wheel temp missing AND no ambient cached → that wheel emits no `psi_cold`; temp_excess also absent
- single valid wheel only → neither `tire_spread_psi` nor any `temp_excess` emitted
- a wheel with valid temp but missing psi still counts toward other wheels' `temp_excess`
- non-finite `ambient.c` payload is ignored (not used as a fallback)
- payload shape assertions (`_type:'ioniq'`, `group`, numeric `value`)
- persistedCache survives across restart (lastRaw pre-seeded → dedupe holds)
