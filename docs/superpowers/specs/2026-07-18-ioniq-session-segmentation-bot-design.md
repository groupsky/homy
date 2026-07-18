# Ioniq EV — Session Segmentation Bot (`ioniq-sessions`) Design

**Date:** 2026-07-18
**Status:** Draft (design), pending user review → implementation plan
**Spec reference:** `docs/ioniq-monitoring-alerting-spec.md` §4.6 (usage/charging), §7 (Trips & charging dashboard), §10 (open items); deferral note in `docs/superpowers/specs/2026-07-15-ioniq-monitoring-phase4-dashboards-design.md` §1.
**Bot pattern templates:** `docker/automations/bots/ioniq-12v-ldc.js` (rolling window, receipt-time math, persisted cache, latch), `docker/automations/bots/ioniq-cell-health.js` (cross-frame merge, never-overwrite-good-with-bad).
**Converter/bridge templates:** `docker/mqtt-influx/converters/ioniq.js`, `docker-compose.yml` service `mqtt-influx-ioniq`.

---

## 0. Context & data reality (why the obvious design is wrong)

The alerting spec assumed trips/charges could be segmented from the `state` tag (active/charging/parked).
**Production data proves that assumption false.** A read-only investigation of the full `ioniq`
measurement on prod (routy) on 2026-07-18 found:

> **Data-depth caveat:** the entire `ioniq` series begins 2026-07-14 (~4.2 days at investigation time).
> Every threshold in this spec is therefore **provisional** and MUST be re-tuned after ~2 weeks of history
> accrues. Sample sizes (≈19 driving runs, 20 park blips, 3 charge blips, 1 overnight charge) are
> suggestive, not statistically solid.

Findings (each backed by InfluxQL run against prod; queries reproduced in §11):

1. **`parked` never persists.** All observed `parked` runs lasted 0–35 s (median 1.4 s) — single
   "last gasp" blips as the logger sleeps. **Real park/sleep is a data gap** (zero samples), observed up
   to **12.2 h** long.
2. **`charging` (tag and field) only catches trivial handshake blips** (~24 min, ~0.5 kWh). It does **not**
   mark real charge sessions.
3. **A single `active` run bundles a full drive *plus* a full charge** with no tag change. Worked example:
   the run `2026-07-15T17:44→07-16T05:28` (tagged `active` throughout) contained a 3 h multi-stop drive,
   then a **10.3 h gap with zero data**, then resume with **SoC jumped 52% → 84.5%** — an invisible
   overnight charge, never tagged `charging`.
4. **The one trustworthy plug signal is `charge_connector`** (group `bcm_b00e`, field `charge_connector`
   0/1). Sparse (~135 pts/400 d) but it flipped `0→1` at charge start and `1→0` at charge end in the
   worked example. It sleeps with everything else, so it is a **corroborator, not a trigger**. (It is
   already reachable under `ioniq/parsed/#` — alerting-spec prerequisite P0-1 has landed; the §0
   investigation queried it live on prod, so no logger work blocks this bot.)
5. **No backwards/duplicate timestamps** in 11,069 rows. Cadence: sub-second–3 s while genuinely driving,
   ~20–45 s while awake-but-idle, **zero** once asleep.

### 0.1 Logger operating behavior (authoritative — operator, 2026-07-18)

These facts override the investigation's inferences where they conflict and are load-bearing for the
algorithm:

- **The logger only lives while the car's ignition is on.** It powers **on ~1–2 min *after* ignition-on**
  and powers **off shortly after ignition-off.** So: (a) every drive's **first 1–2 min are missing** — the
  trip's start `soc`/`odometer`/counters are captured slightly late, so distance/energy **slightly
  undercount** the true drive and are flagged accordingly (§5); (b) **a data gap = ignition-off = the car
  is parked/charging.** The multi-hour gaps in §0 are ignition-off periods.
- **`ignition` is trustworthy** as the awake/session signal (the investigation called it "unreliable" only
  because it reads 1 through *stationary-but-on* stretches — which is correct: the car is on, just not
  moving). Because the logger runs only under ignition, `ignition ≈ 1` for essentially every logged
  sample; its value to us is the **1→0 edge at session end** (often captured as the brief `parked`
  "last gasp") and **continuity across short gaps** (§3).
- **`gear` is trustworthy** and the *cleanest* drive/park signal — better than speed alone. **Verified on
  prod:** string values `P`/`N`/`D`/`R`, on **group `vmcu`** (NOT `bms/2101` — the bot must subscribe
  `ioniq/parsed/vmcu`), densely populated (every `vmcu` sample, no gaps), and cleanly correlated (`P`⇔
  stopped/parked, `D`⇔forward, `R`⇔reverse, incl. `D→R→D` parking maneuvers). `gear=P` = definitive
  **parked** (trip ended); `D`/`R` = driving; `N` = ambiguous (continuation). It ends a trip the instant the
  driver parks — no waiting out `minRestSplitMs` — and stops a long red light (stopped, still in `D`) from
  splitting a trip. Top-priority boundary signal; speed + `minRestSplitMs` is the fallback when gear is
  absent. (`speed_kph` is on both `vmcu` and `bms/2101`.)
- **Configurable fetch cadence:** fast-changing signals ~2 s, slower signals ~1 min. So a ~1-min gap on a
  given field is *normal cadence*, not a rest — gap thresholds must sit comfortably above 1 min. **The
  operator can raise the cadence of specific fields on request — see §7.1 for the prioritized list** (most
  impactfully `odometer`, whose sparsity is the single biggest metric-quality limit).
- **Mid-drive reboots happen**, causing gaps **usually 1–3 min** (occasionally more). These occur with
  ignition on throughout and must **not** split a trip (validates §3.2's moving/ignition-continuity rule;
  and note the "43 s max dropout" figure was a 4.2-day fluke — real dropouts reach 1–3 min).
- **Charging signal, in strength order:** **(1) positive SoC change across an ignition-off gap** is a
  reliable charge indicator; **(2) the household charger energy meter** — `charger`/`or-we-526`, MQTT
  `/modbus/monitoring/charger/reading`, a separate always-on Modbus device that **keeps logging while the
  car sleeps** — is a **very strong** corroborator that **time-bounds** a home charge and gives AC-side
  kWh. **Verified on prod over 609 days (2024-11 → 2026-07):** live and dense (~8 s ticks), writes to
  InfluxDB measurement **`xymd1`** (tags `device.name=charger`; fields `ap`=W, `act`=cumulative kWh),
  **0 W idle baseline** (99.98% of idle samples exactly 0 W), **three charging tiers ~1.2 / 1.9 / 2.6 kW**
  (the two higher fell out of recent use — hence a 30-day glance sees only 1.2 kW), **no daytime other-load**
  on the circuit in the whole window, and its on/off edges matched the known overnight charge to within
  ~5–9 min on the same clock (AC 12.46 kWh → pack 10.1 kWh = 81% efficiency). The bot uses a **relative**
  power threshold (150 W), not hard-coded tiers, so it stays correct across all tiers (§3.3, §12).

**Design consequence:** segmentation **must not key off the `state` tag.** It keys off **`ignition`
(awake/session delimiter) + `speed_kph` (drive vs idle within awake) + inter-sample gaps (rest detection) +
cumulative-counter / SoC deltas (charge detection)**, with the **charger energy meter** bounding home
charges. The `state` tag is at most a weak secondary hint, never a boundary.

---

## 1. Goal & scope

Deliver **`ioniq-sessions`**, an automations bot that segments the Ioniq telemetry stream into discrete
**sessions** and emits **one summary record per completed session** for the deferred "Trips & charging"
Grafana dashboard (spec §7 row 5) and parasitic-drain analysis (spec §4.6).

### In scope
- **Three session kinds**, covering the timeline with no gaps:
  - `trip` — a period of real motion (a fine-grained drive segment).
  - `charge` — a rest during which energy entered the pack.
  - `park` — a rest during which no charging occurred.
- **Aggregation only.** One record emitted per closed session, with per-session metrics and data-quality
  metadata.
- **Robust missing-data handling** (§5) — the logger sleeps mid-session and data gaps are the norm.
- New InfluxDB **records** measurement `ioniq_sessions` + a dedicated mqtt-influx bridge instance (§6).

### Explicitly out of scope (non-goals)
- **No alerting.** No thresholds, no Telegram, no derived 0/1 flags. Charge-stall / low-SoC-at-park
  alerting remains the separately-planned `ioniq-charge-guard` bot (alerting spec §4.6, §5). This bot and
  charge-guard are independent; neither depends on the other.
- **No coarse "journey" aggregation.** Merging fine `trip` segments separated by short stops into one
  logical journey (the VW-style "reset only after 30–60 min of ignition-off") is a **followup bot** that
  consumes `ioniq_sessions`. This bot emits the atomic, well-bounded unit; policy-layer coalescing is
  someone else's job. (Naming: the fine session is a **`trip`**; a future coalesced unit is a **journey**.)
- **No AC/DC charge-*type* decode.** OBC `dc_*` only populates during rare handshake blips, so `charge_type`
  stays `unknown` (a charger-meter match implies AC). Pack-side counters give charge *energy* always; the
  verified home **charger meter** additionally gives AC energy/efficiency and time-bounds home charges
  (§3.3) — that is in scope. Away-from-home charges without a meter stay energy-only (`bounds:unbounded`).
- **No Grafana dashboard in this spec.** The "Trips & charging" dashboard is a separate deliverable that
  consumes this measurement (out of scope here; unblocked by it).
- **No logger-side changes.**

---

## 2. Architecture

```
logger ──MQTT──> ioniq/parsed/#  ──> (existing per-sample telemetry pipeline, unchanged)
                      │
                      ├─> mqtt-influx-ioniq ──> InfluxDB "ioniq"        (2 Hz telemetry, unchanged)
                      │
   automations ─subscribe ioniq/parsed/{vmcu,bms/2101,odometer,bcm_b00e,ambient}┐
   bot: ioniq-sessions   + /modbus/monitoring/charger/reading (meter)   │  gear+ignition+motion+gap+counter,
                      │  emits ONE record per closed session            │  meter-bounds home charges
                      ▼                                                  ▼
             ioniq/derived/{trip,charge,park}  ──> mqtt-influx-ioniq-sessions ──> InfluxDB "ioniq_sessions"
                      │                                (NEW bridge instance)         (records table)
                      └────────────────────────────> mqtt-mongo-ioniq (existing ioniq/# sub) ──> Mongo
```

- **Bot** lives in `docker/automations/bots/ioniq-sessions.js`, wired in `config/automations/config.js`
  alongside the other ioniq bots. Follows the repo bot contract
  `module.exports = (name, config) => ({ persistedCache, start })`.
- **New bridge** `mqtt-influx-ioniq-sessions` (a second instance of the existing `mqtt-influx` image, no
  Dockerfile) subscribes `TOPIC=ioniq/derived/#` and routes to a **new converter** keyed by
  `_type: 'ioniq-session'` that writes measurement **`ioniq_sessions`**.
- **Why a separate measurement, not `ioniq`:** session records are a low-rate, wide, categorical
  *records table*, semantically distinct from 2 Hz telemetry. Keeping them out of `ioniq` keeps dashboards
  simple (query a records table, not filter a firehose) and keeps the existing `ioniq/parsed/#` bridge
  untouched. (Chosen 2026-07-18.)
- Session records also reach Mongo automatically via the existing `mqtt-mongo-ioniq` (`TOPIC=ioniq/#`)
  subscription — free durable record history, no new wiring.

---

## 3. Session model & detection algorithm

### 3.1 The unified model: awake-session → {motion, idle}, sleep-gap → rest

The timeline has two levels. **`ignition`** delimits *awake sessions* (the logger only lives with ignition
on, §0.1); within an awake session, **`speed_kph`** separates driving from idling; the *sleep gaps between*
awake sessions are the rests to classify.

- **Awake session** = a contiguous run of samples (ignition on). It begins ~1–2 min after real ignition-on
  (startup lag → early samples missing) and ends at the `ignition` 1→0 edge (often the brief `parked`
  "last gasp") or, if that edge isn't captured, at the **silence timeout** (§3.4).
- **Driving** = `gear ∈ {D, R}` **or** (gear absent and `speed_kph > speedMovingKph`, provisional 3 km/h to
  reject standstill jitter). Accumulates into an open **`trip`**. A stop still in gear `D`/`R` (red light)
  is *not* an idle — the trip continues.
- **Idle / parked** = the drive ended. Triggered, in priority order: **`gear=P`** (definitive, immediate);
  else, gear absent, an ignition-on **stationary** stretch exceeding `minRestSplitMs` (provisional 3 min).
  `gear=N` is ambiguous (neutral at a light / rolling) → continuation, never a split on its own. Sub-floor
  stops don't split — the fine-but-sane floor; coarse journey-merging is the followup bot (§1).
- **Rest** = a **sleep gap** between awake sessions (ignition off → logger dead → no samples). Classified
  `charge` or `park` by SoC/energy delta across it, bounded by the charger meter where available (§3.3).

**Reboot continuity (do not mistake a reboot for a rest).** Mid-drive logger reboots produce gaps usually
1–3 min *with ignition on throughout* (§0.1). A gap does **not** open a rest when either: the post-gap
sample is **moving** (you cannot wake mid-motion — definitely the same trip), **or** the gap is shorter
than `rebootMaxGapMs` (provisional 5 min, above the 1–3 min reboot band and the ~1-min slow-field cadence)
with ignition on on both sides (reboot or a trivial sub-5-min stop — merged into the awake session either
way). A rest opens only on a gap ≥ `restGapMs` (provisional 5 min) or an observed `ignition` 1→0 edge. The
gap's own elapsed time never counts toward `minRestSplitMs` (which measures *observed* stationary-awake
samples, not silence).

`rebootMaxGapMs == restGapMs` (both 5 min) is intentional, not a dead zone: a gap is *either* < 5 min
(continue) *or* ≥ 5 min (rest if the far side is stationary). The only case needing unconditional
protection is **moving-both-sides** (a highway reboot/tunnel), which continues regardless of gap length. A
gap ≥ 5 min with a *stationary* far side is treated as a genuine **short `park`** — and correctly so: the
car really was at rest for ≥ 5 min, already past the 3-min `minRestSplit` floor, so even a "reboot while
parked" is indistinguishable from (and equivalent to) a real short stop. No trip is wrongly fragmented,
because fragmentation only matters when the car kept moving — and that path is protected.

### 3.2 Boundary triggers & finalization

The bot is event-driven on incoming samples plus one silence timer. The single most important rule, from
which most edge-case correctness follows: **a rest boundary requires the car to actually be at rest —
`speed_kph ≤ speedMovingKph` — on the far side of the gap. You cannot fall asleep and wake up mid-motion.**

1. **Motion → rest (trip closes):** a `trip` finalizes when the car comes to rest — (a) **`gear=P`**
   observed (definitive, highest priority); or (b) gear absent and a *stationary* (speed ≤ threshold,
   ignition on) stretch exceeds `minRestSplitMs`; or (c) the next sample arrives after a gap ≥ `restGapMs`
   **and that next sample is stationary** (or `gear=P`); or (d) an observed `ignition` 1→0 edge; or (e) the
   **silence timer** fires (§3.4). Trip `end_ts` = timestamp of the **last in-motion sample** (or the
   `gear=P` sample), never "now". A stop in gear `D`/`R` never closes the trip.
   - **Moving-both-sides / reboot ⇒ one trip (no phantom park).** A gap bracketed by motion on both sides,
     or any gap < `rebootMaxGapMs` with ignition on both sides (§3.1 reboot continuity — reboots run 1–3
     min, the "43 s max" was a 4.2-day fluke), **continues** the trip. No spurious `park`; `distance`/
     `energy` not fragmented.
2. **Rest → motion (rest closes):** when motion resumes (a `speed > threshold` sample) after a significant
   rest, the open rest finalizes and is classified (§3.3). Rest `start_ts` = last pre-rest (in-motion or
   last-awake) sample; `end_ts` = the **resuming sample**.
3. **Rests finalize retrospectively.** Because a sleep rest ends only when data *resumes*, charge/park
   records are computed on resume by comparing the **last pre-gap snapshot** to the **first post-gap
   sample**. The pre-gap snapshot (counters, soc, odometer, connector) lives in `persistedCache`, so it
   survives a mid-gap restart — this is what makes the invisible overnight charge (§0 finding 3) detectable
   *and* restart-safe (§5).

### 3.3 Rest classification & sub-segmentation (park / charge / park)

A real overnight rest is physically **park → charge → park** (the car parks, sits, charges, then sits
again until morning). Treating the whole rest as one `charge` would report the *drive-to-drive interval* as
the charge — e.g. the §3.5 example's 10.1 kWh over 10.3 h yields a nonsense **0.98 kW** "charge rate" (a
real Ioniq OBC does 3.3–6.6 kW). So classification is **energy-triggered but connector-bounded**, and it
is honest about what it cannot measure:

**Step 1 — is there a charge at all?** Yes if, across the rest, `Δcum_in_kwh ≥ chargeMinKwh` (0.3) **or**
`Δcum_chg_ah ≥ chargeMinAh` (1) **or** `Δsoc ≥ chargeMinSocPct` (+2%). Energy/Ah/SoC deltas from the pack
counters are **always valid** (they're the difference of two monotonic readings) — a charge's *magnitude*
is robust even across a total sleep gap.

**Step 2 — can we bound *when* the charge happened?** (in priority order)
- **`bounds: meter` (home charge — preferred, verified over 2 years of meter data).** The household charger
  meter (`charger` / `or-we-526`, MQTT `/modbus/monitoring/charger/reading`, a **separate always-on Modbus
  device that keeps logging while the car sleeps**) has a **0 W idle baseline** (99.98% of idle samples
  exactly 0 W) and **three charging tiers ~1.2 / 1.9 / 2.6 kW** with **no daytime other-load** on the
  circuit in 609 days — a clean single-purpose signal. The bot keeps a persisted record of meter power
  on/off **edges** (with the `act` cumulative-kWh counter at each edge). On rest close, if the meter shows a
  power-on interval inside the rest window — power `> chargerMeterOnW` (150 W, above the ≤5 W noise floor and
  below every tier) sustained `> chargerMeterOnMinMs` (60 s), ending when power stays `< chargerMeterOnW` for
  `chargerMeterOffMinMs` (2 min, to ride the observed multi-step end-taper) — that interval **bounds the
  charge**: real `duration_sec`, `power_avg_kw`, `ac_energy_kwh = Δact`, and `charge_efficiency =
  energy_in_kwh / ac_energy_kwh` (verified overnight case: 10.1 kWh pack / 12.46 kWh AC = 81%). A **relative**
  threshold (not tier-hardcoded) keeps this correct across all three tiers and any future one.
  `duration_is_charge: true`. (Meter and car share the same server clock; edges aligned within ~5–9 min.)
- **`bounds: connector` / `bounds: awake`.** No meter match (away-from-home charge, or meter gap), but the
  rest contains captured `charge_connector` `0→1`/`1→0` edges or intermediate awake samples → bound the
  charge at those edges. `duration_is_charge: true` (`ac_energy_kwh`/`charge_efficiency` null — no meter).
- **`bounds: unbounded` (pure sleep charge, no meter/edges — the away-charge worst case).** The logger
  slept through plug-in→charge→unplug and no home meter saw it (`charge_connector` reads 1 pre-gap and 0
  only on resume — real unplug time unknown). Emit **one** `charge` for the whole rest with valid
  `energy_in_kwh`/`charge_ah`/`soc_delta_pct` but `duration_is_charge: false`, `power_avg_kw: null`, and
  `soc_end` flagged post-rest (reflects post-charge drain, not charge-complete SoC). **No fabricated
  0.98 kW.** We do not invent park sub-sessions we cannot measure; the pre/post-charge park time is
  acknowledged as absorbed and unmeasurable in v1.

**No-charge rest ⇒ `park`** (including SoC-flat and the normal parasitic-drain case where SoC drifts
*down*). Because a rest has **no motion**, a charge rest's `Δcum_in_kwh` is ~pure charge energy (no regen) —
this is why segmenting by session, not by a naive time window, avoids the regen-overcount the investigation
warned about.

### 3.4 Silence timer (trailing session close) — idempotent w.r.t. an already-open rest

A `trip` or awake-idle rest that is the **last activity before sleep** never sees a "next sample". A
wall-clock timer (receipt-time, the `timeout-emit` pattern) is (re)armed on every sample for
`silenceTimeoutMs` (provisional 5 min, above the reboot band). When it fires:
- if a **`trip`** is open, finalize it (end = last in-motion sample) and open a **pending rest** covering
  everything after that sample;
- if a **rest is already open** (awake-idle that then fell asleep), **do not create a second rest** — just
  mark the existing open rest pending (extend it). Opening-a-pending-rest is idempotent: at most one rest
  is ever open. (Fixes the double-rest / back-to-back-rests artifact.)

The pending rest stays open in `persistedCache` and is finalized+classified on the next motion resume, or
lazily on restart (§5). A late straggler *stationary* sample arriving after the timer fired simply updates
the still-open rest's snapshot; it does not close anything (only motion or a subsequent timeout closes a
rest).

### 3.5 Worked mapping against the real data

The problematic `active` run from §0 finding 3 decomposes correctly:
`trip` (17:44→18:32, motion) → silence timer fires 5 min after the last moving sample, `trip` finalized,
**pending rest** opened (pre-gap snapshot: `cum_in`, `soc=52`, `connector=1`) → 10.3 h sleep gap (survives
any restart via the persisted snapshot) → resume 04:55 (stationary) with `Δcum_in_kwh +10.1`,
`Δcum_chg_ah +27.5`, `Δsoc +32.5` → rest classified **`charge`**; no intermediate samples ⇒ **unbounded**:
`energy_in_kwh=10.1` (valid), `power_avg_kw=null`, `duration_is_charge=false`, `connector_confirmed=true` →
next `speed>3` sample opens a new `trip`. Clean, honest records where the `state` tag produced one
meaningless 704-minute blob.

---

## 4. Per-session metrics (all fields verified present on prod, 2026-07-18)

All numeric metrics are **null when their source is missing or a boundary sample is absent** (§5) — never
zero, never fabricated. Deltas are `last_in_session − first_in_session` unless stated.

### 4.1 `trip`
| Field | Source | Unit / note |
|---|---|---|
| `duration_sec` | end_ts − start_ts | s |
| `distance_km` | `odometer` (group `odometer`) Δ | km; **null unless ≥2 distinct readings** (never 0); known-approximate (§5.3) |
| `odometer_coverage` | odometer span ÷ `duration_sec` | 0–1; lets a consumer discount low-coverage distance |
| `energy_out_kwh` | `cum_out_kwh` (bms/2101) Δ | kWh discharged |
| `energy_regen_kwh` | `cum_in_kwh` (bms/2101) Δ, **minus any `charge_connector==1` interval** | kWh; a sub-`minRestSplitMs` plugged top-up mid-trip must not be mislabeled regen (§4.1 note) |
| `energy_net_kwh` | `energy_out_kwh − energy_regen_kwh` | kWh |
| `efficiency_wh_per_km` | `energy_net_kwh / distance_km × 1000` | Wh/km; **null if `distance_km` null**; explicitly guarded against `0`/`NaN`/`Infinity` |
| `soc_start` / `soc_end` / `soc_delta_pct` | `soc` (bms/2101, dense) | % (see SoC note below) |
| `speed_avg_kph` / `speed_max_kph` | `speed_kph` (bms/2101) | km/h |
| `power_max_kw` | max `hv_kw` | kW (positive = discharge) |
| `ambient_c` | `ambient` group if present | °C (best-effort; may be null) |

> **SoC field choice:** all SoC math uses **`soc`** (dense, on `bms/2101` alongside speed/counters), not the
> sparser `soc_display` (`bms/2105`). `soc` is the BMS true state-of-charge; `soc_display` is the
> dash-shown, buffer-scaled value. Rationale: co-located density and consistency across all three session
> kinds. If a *user-facing* %/day or charge-Δ should instead track the dash value, that is a documented
> config switch, not a silent choice. (Verify both fields' presence/ranges during tuning, §11.)

> **Regen-vs-plugged note (Opus finding 8):** `cum_in_kwh` credits both regen (driving) and charging. A
> plugged top-up during a stop shorter than `minRestSplitMs` stays inside the trip; the bot subtracts any
> interval with `charge_connector==1` from `energy_regen_kwh` (and flags the trip `contained_plugged:true`)
> so charge energy is never reported as regen.

### 4.2 `charge`
Energy/Ah/SoC deltas are **always valid** (differences of monotonic counters, robust across a full sleep
gap). *Timing* (`duration`/`power`) is valid only when the charge is **bounded** (§3.3): by the charger
meter (home charge — preferred), or by captured `charge_connector` edges / intermediate awake samples. An
**unbounded** sleep charge reports energy but **nulls** timing rather than fabricating a rate.

| Field | Source | Unit / note |
|---|---|---|
| `energy_in_kwh` | `cum_in_kwh` Δ across rest | kWh into pack; always valid |
| `charge_ah` | `cum_chg_ah` Δ | Ah; always valid |
| `soc_start` / `soc_delta_pct` | `soc` | %; always valid |
| `soc_end` | `soc` at charge end (bounded) or at resume (unbounded) | %; when unbounded, reflects post-charge drain — flagged |
| `bounds` | `meter` \| `connector` \| `awake` \| `unbounded` | how (if at all) timing was bounded |
| `duration_is_charge` | true only when `bounds ≠ unbounded` | boolean |
| `duration_sec` | plugged interval (bounded) or whole-rest span (unbounded) | s; interpret with `duration_is_charge` |
| `power_avg_kw` | `energy_in_kwh / (charge_duration/3600)` when bounded, else **null** | kW; **never the drive-to-drive-interval rate** |
| `connector_confirmed` | `charge_connector` (`bcm_b00e`) == 1 during rest | boolean corroborator |
| `ac_energy_kwh` | charger meter `act` Δ over the plugged interval (home charge) | kWh; null if meter unavailable (away charge) |
| `charge_efficiency` | `energy_in_kwh / ac_energy_kwh` | 0–1 wall-to-pack; null without meter |
| `charge_type` | `obc.dc_*` presence for `bounds:awake`; else `unknown` | `AC`/`DC` only for a rare powered-mode (awake) charge where OBC `dc_*` decodes; a home-meter match implies `AC`; else `unknown` |

### 4.3 `park`
| Field | Source | Unit / note |
|---|---|---|
| `duration_sec` | end_ts − start_ts | s |
| `soc_start` / `soc_end` / `soc_delta_pct` | `soc` | % (negative delta = parasitic drain) |
| `soc_drain_pct_per_day` | `−soc_delta_pct / (duration_sec/86400)` | %/day; null if duration < `drainMinDurationMs` |
| `aux12v_start` / `aux12v_end` | `aux_12v` (bms/2101) | V; best-effort at boundaries |
| `connector_confirmed` | `charge_connector` == 0 throughout | boolean (sanity: a park should not be plugged) |

### 4.4 Common metadata on **every** record
| Field | Meaning |
|---|---|
| `kind` | `trip` \| `charge` \| `park` (also the InfluxDB tag, §6) |
| `start_ts` / `end_ts` | epoch ms; `start_ts` is the InfluxDB point timestamp |
| `complete` | both start and end boundary samples were present (else metrics that need the missing side are null) |
| `sample_count` | in-session samples seen (0 for a pure sleep rest — all metrics boundary-derived) |
| `max_gap_sec` | largest inter-sample gap inside the session (0 if <2 samples) |
| `closed_by` | `gear_park` \| `ignition_edge` \| `idle_split` \| `gap_stationary` \| `motion_resume` (rest→drive) \| `silence_timeout` \| `restart_lazy_close` |
| `gear_at_close` | the `gear` value that closed the trip, or null if closed without gear | audit/tuning |
| `seq` | monotonic per-emit counter; with `(kind,start_ts,end_ts)` forms the de-dup key (§5.6) |
| `schema_version` | integer, for downstream forward-compat |

`trip` records additionally carry `start_truncated:true` (the 1–2 min logger startup lag means the first
moments of the drive are unsampled, so `distance`/`energy` slightly undercount — §0.1).

---

## 5. Missing-data & edge-case policy

The core design principle: **the bot never fabricates a metric, and never silently loses a session.**
Concretely:

1. **Boundary-derived when asleep.** Sleep rests have `sample_count = 0`; metrics are `pre-gap snapshot`
   vs `post-gap sample`. If a boundary is absent (bot started mid-gap; pre-sleep sample never seen),
   affected metrics are **null** and `complete = false`.
2. **Counter-reset guard = negative delta only.** `cum_*`/`odometer` are monotonic; a **negative** delta
   ⇒ reset (or bad baseline) ⇒ that metric **null** + `complete = false`. Do **not** cap *positive* jumps
   at a small value: a 60 km trip is a legitimate +60 km odometer jump, and a bulk charge is a legitimate
   `cum_in` jump. The plausibility ceiling (`maxPlausibleStepKm`) is set **above a full-range trip**
   (provisional 400 km, ~1.5× the car's ~250 km range) purely to catch corruption, never normal use.
3. **Distance needs ≥2 *distinct* odometer readings, else null — never 0.** Odometer is sparse (~1/82 min,
   §0). A trip with one (or zero) odometer sample yields **null** `distance_km` (not `last−first = 0`), and
   any metric dividing by it (`efficiency_wh_per_km`) is **null** — explicitly guarded against `0`/`NaN`/
   `Infinity`. Even with ≥2 readings, both may sit *interior* to the true motion span (start/end minutes
   unsampled, compounded by the 1–2 min startup lag, §0.1), so distance under-counts and efficiency
   over-estimates; the record carries `odometer_coverage` (odometer span ÷ trip duration) so a consumer can
   discount low-coverage figures. Distance is a *known-approximate* metric, flagged, not a precise one.
4. **Lazy close is session-type-aware (fixes the overnight-charge-loss bug).** The open session + its start
   snapshot live in `persistedCache`, surviving restarts. On the resume sample after a restart:
   - open **trip** → finalize (end = last in-motion sample), then process the resume normally;
   - open **rest** → close it with **end = the resuming sample** (NOT "last recorded sample" — a rest's
     last recorded sample is the *pre-gap* one, which would make `Δcum_in = 0` and misclassify a real
     charge as park); and **only if the resume is motion or a fresh gap ≥ `restGapMs` follows**. If the
     resume sample is still **stationary**, the rest stays open and keeps accumulating — a restart mid-park
     must not chop one park into two (which would corrupt `soc_drain_pct_per_day`) nor split a charge such
     that each half falls under `chargeMinKwh`. `closed_by = restart_lazy_close` records the path.
5. **Exactly-once into InfluxDB; at-least-once into Mongo (honest guarantee).** `persistedCache` persists
   **asynchronously with debouncing** (automations framework), so a crash between "publish" and "flush"
   can re-emit a session. InfluxDB is **idempotent** on `(measurement, kind-tag, start_ts-timestamp)` — a
   re-emit overwrites the same point, harmless. **Mongo (`mqtt-mongo-ioniq`, `ioniq/#`) is append-only, so
   a re-emit duplicates the record there.** Mitigation: set an `emitted:true` marker on the open session
   *in the same mutation that computes it, before publishing*, so a replay sees it as already-emitted; this
   shrinks but does not eliminate the window. Documented, not over-claimed. Downstream Mongo consumers must
   de-dup on `(kind, start_ts, end_ts)`.
6. **De-dup key = `(kind, start_ts, end_ts)`, not `start_ts` alone.** Consecutive sessions can legitimately
   share a boundary timestamp (a rest's `start_ts` = the prior trip's last sample). Keying only on
   `start_ts` would drop the rest. The bot also **rejects degenerate single-sample "trips"**
   (`< minTripDurationMs` **and** `< minTripSamples`) — a lone `speed>3` jitter sample at the 3 km/h floor
   is not a trip — which also removes the same-timestamp collision at the source.
7. **Malformed/partial payloads** don't advance state (mirrors `ioniq-12v-ldc.isValidSample`), but a
   payload carrying *some* usable fields still refreshes the boundary snapshot for the fields it has.
8. **All thresholds are `config`, provisional**, re-tuned after ~2 weeks (§0, §11).

---

## 6. Output schema & ingestion

### 6.1 MQTT
- Topics: `ioniq/derived/trip`, `ioniq/derived/charge`, `ioniq/derived/park`.
- Payload: a flat object of the §4 fields plus `_type: 'ioniq-session'` and `kind`. Published via
  `mqtt.publish(topic, obj)` (framework serializes; objects not strings — automations CLAUDE.md).

### 6.2 Converter — `docker/mqtt-influx/converters/ioniq-session.js` (new)
- Keyed by `_type: 'ioniq-session'` in `docker/mqtt-influx/index.js` converters map.
- Emits `new Point('ioniq_sessions')`.
- **Tag:** `kind` (low-cardinality: 3 values) — the only tag; dashboards filter/group by it.
- **Timestamp:** `start_ts` (epoch ms). Records are back-dated to session start so a "trips over time"
  axis places each session where it began. `end_ts` carried as a field.
- **Fields:** all §4 numeric/boolean/string metrics, typed by JS runtime type (reuse the `addField`
  typing discipline from `converters/ioniq.js`: finite numbers → float, booleans → boolean, strings →
  string; null/undefined skipped so a null metric simply omits its field rather than writing a sentinel).
- **Reserved set:** widen the converter's `RESERVED` set beyond `converters/ioniq.js`'s
  (`_type, group, state, ts`) to also exclude `kind` (it's the tag) and the framework's auto-added
  `_bot`/`_tz` envelope metadata — otherwise those leak in as spurious string fields (a pre-existing quirk
  in the `ioniq` converter we deliberately do not replicate here). `start_ts`/`end_ts` stay as
  fields/timestamp per above.

### 6.3 New bridge instance — `docker-compose.yml`
Clone the `mqtt-influx-ioniq` service block verbatim as `mqtt-influx-ioniq-sessions`, changing **only**:
- `TOPIC=ioniq/derived/#`
- `MQTT_CLIENT_ID=mqtt-influx-ioniq-sessions`

Everything else is carried forward **unchanged** from `mqtt-influx-ioniq` (do NOT hardcode any of it):
`image` + `build: docker/mqtt-influx`, `depends_on: [broker, influxdb]`, `networks: [automation, egress]`,
`security_opt: [no-new-privileges]`, `secrets: [influxdb_write_user, influxdb_write_user_password]`,
`logging`, and env `BROKER`, `INFLUXDB_URL`, `INFLUXDB_USERNAME_FILE`, `INFLUXDB_PASSWORD_FILE`, and
`INFLUXDB_DATABASE=${INFLUXDB_DATABASE}` (a variable reference, matching every sibling block — same db,
different measurement via the converter). No new env-var *names* are introduced, so `example.env` needs no
change. Add a Dependabot entry only if a new directory is introduced — none is (reuses the `mqtt-influx`
image; `/docker/mqtt-influx` already has `docker` + `npm` entries in `.github/dependabot.yml`), so no
`.github/dependabot.yml` change is required.

### 6.4 Documentation deliverables (required by CLAUDE.md)
- **`docs/influxdb-schema.md`** — document the new `ioniq_sessions` measurement (tag `kind`; all §4 fields
  with units; back-dated `start_ts` timestamp semantics).
- **`docker/mqtt-influx/CLAUDE.md`** — add the `ioniq-session` converter and `mqtt-influx-ioniq-sessions`
  instance to the converter/instance lists.
- **`docs/ioniq-monitoring-alerting-spec.md`** — flip the §7 "Trips & charging" deferral note to point at
  this bot as the data source; and **correct §10's "verify the `charger` ORNO meter is live" open item** —
  it *is* live, it just writes to measurement `xymd1` (not a `monitoring`/`charger`-named one), which is
  why the original query found nothing.

---

## 7. Bot implementation shape

Config block (in `config/automations/config.js`), all thresholds provisional & overridable:

```javascript
ioniqSessions: {
  type: 'ioniq-sessions',
  bmsTopic: 'ioniq/parsed/bms/2101',        // ignition, speed_kph, soc, hv_kw, aux_12v, cum_* counters, ts
  vmcuTopic: 'ioniq/parsed/vmcu',           // gear (P/N/D/R string), speed_kph — gear is HERE, not bms/2101
  gearParkValue: 'P',                       // verified string 'P' = parked
  odometerTopic: 'ioniq/parsed/odometer',   // km (sparse ~1/82min)
  connectorTopic: 'ioniq/parsed/bcm_b00e',  // charge_connector (sparse corroborator / awake-charge bound)
  ambientTopic: 'ioniq/parsed/ambient',     // optional; ambient_c best-effort
  chargerMeterTopic: '/modbus/monitoring/charger/reading', // charger or-we-526; fields ap(W), act(kWh); home-charge bound + AC kWh
  tripTopic: 'ioniq/derived/trip',
  chargeTopic: 'ioniq/derived/charge',
  parkTopic: 'ioniq/derived/park',
  // thresholds (PROVISIONAL — re-tune after ~2 weeks of history, §11)
  speedMovingKph: 3,           // > this = moving (rejects standstill jitter)
  minRestSplitMs: 180000,      // 3 min OBSERVED stationary-awake splits a trip
  restGapMs: 300000,           // 5 min gap = sleep/rest boundary (above the 1-3 min reboot band + 1 min slow cadence)
  rebootMaxGapMs: 300000,      // gaps below this with ignition on both sides = reboot, NOT a rest
  silenceTimeoutMs: 300000,    // 5 min silence closes a trailing session (> reboot band)
  minTripDurationMs: 60000, minTripSamples: 3, // reject degenerate single-sample jitter "trips"
  chargeMinKwh: 0.3, chargeMinAh: 1, chargeMinSocPct: 2,   // any ⇒ the rest contained a charge
  chargerMeterOnW: 150, chargerMeterOnMinMs: 60000, chargerMeterOffMinMs: 120000, // on: >150W sustained >60s; off: <150W for >2min (rides taper). 0W baseline + 3 tiers (1.2/1.9/2.6kW) verified over 2yr
  drainMinDurationMs: 3600000, // 1 h min park before %/day drain is meaningful
  maxPlausibleStepKwh: 40, maxPlausibleStepKm: 400, // corruption ceilings ONLY (above full-range trip/bulk charge)
  socField: 'soc',            // 'soc' (dense, default) vs 'soc_display' (dash) — documented switch, §4.1
}
```

`persistedCache` (version 1, with `migrate`) holds: the open session (kind, start snapshot, running
reducers — min/max/sum for speed & power, plugged-interval accumulator, first/last snapshots of counters,
odometer, soc, aux_12v, ignition, connector; sample count; max gap; `emitted` flag §5.5), the pending-rest
snapshot, the **charger-meter on/off edge record** (`{ts, act}` per edge, spanning the current rest — so a
metered charge survives restart, else it degrades to `bounds:unbounded`, §5.4), `lastSampleRxTs`/
`lastSampleTs`, `lastIgnition`, and the de-dup ledger (`lastEmitted: {kind,start_ts,end_ts,seq}`, §5.6).
Snapshots + reducers + edges (not a raw window — unlike `ioniq-12v-ldc`) keep the cache small and
restart-cheap.

Subscribe to the input topics and maintain a **merged latest-view** across groups (cell-health-style
last-known merge, since the boundary signals are split across frames): **`vmcu` carries `gear`+`speed_kph`**
(the primary motion/park signals) and **`bms/2101` carries `ignition`+`soc`+`hv_kw`+`cum_* counters`**. Each
`vmcu` or `bms/2101` message updates its fields in the merged view and triggers a state evaluation stamped
with that message's receipt time; `odometer`/`connector`/`ambient` only refresh their boundary snapshots.
`chargerMeterTopic` (a *separate always-on Modbus device*, not ioniq telemetry) feeds a **persisted
power on/off edge record** — each edge stores `{ts, act}` when `ap` crosses `chargerMeterOnW` (debounced by
`chargerMeterOnMinMs`) — **not** a raw recent-sample buffer. Two edges (on, off) are all §4.2 needs
(`duration = t_off−t_on`, `ac_energy_kwh = act_off−act_on`, `power_avg_kw`, `charge_efficiency`); storing
edges (bounded, tiny) means an on-edge at the *start* of a 10 h overnight charge survives to rest-close,
where a "recent" buffer would have aged it out. The edge record lives in `persistedCache` (below), so it
survives a mid-charge restart. The bot correlates meter and car by wall-clock; both streams are on the
same broker/InfluxDB server-time (verified aligned within ~5–9 min, §0.1/§12).

---

### 7.1 Logger enhancement requests (optional — the bot degrades gracefully without them)

The operator can raise the log cadence of specific fields. None of these block v1 (the bot flags the
affected metric approximate/null when data is thin), but each measurably improves quality. Prioritized:

| # | Field (group) | Current | Requested | Payoff |
|---|---|---|---|---|
| 1 | **`odometer`** (`odometer`) | ~1 / 82 min | every ~15–30 s **while `gear ∈ {D,R}`** (or on-change) | The single biggest fix: makes `distance_km` and `efficiency_wh_per_km` reliable instead of frequently null/low-coverage (§5.3). |
| 2 | **`gear`** (`vmcu`) | dense (verified) | keep it in the ~2 s fast group | Prompt `gear=P` trip-close and red-light-doesn't-split correctness (§3). Already dense — no change likely needed. |
| 3 | **`charge_connector`** (`bcm_b00e`) | ~135 / 400 d | on-change (0↔1), or ≥ every 30 s while plugged | Better charge corroboration and `bounds:connector` timing for **away** charges (no home meter). |
| 4 | **`hv_kw`,`cum_in_kwh`,`soc`** during **powered-mode charging** | only when awake | 2 s cadence whenever the car is in powered mode while plugged | The rare powered-mode charge (§0.1: the early short AC/DC charges) becomes a fully **`bounds:awake`** session with a real in-session power curve — precise ground truth to calibrate the meter-side thresholds. |

Rationale for #1: odometer sparsity is called out three times (§4.1, §5.3, §12) as the dominant metric
limitation; denser odometer during driving removes it without any bot change.

## 8. Testing plan (TDD, Jest, mocked MQTT — repo standard)

Fixtures built from the **real payload shapes** observed on prod (nested where the logger nests; the tpms
lesson from phase-4 §1.1 — fixtures must match reality or bugs pass review). Fail-before/pass-after per
`superpowers:test-driven-development`.

Required scenarios (each maps to a design decision / review finding):
- **Clean trip** → one `trip` with correct deltas (41.6-min worked example: soc 73→61, `cum_out` +4.7 kWh,
  odo +40 km, sane Wh/km).
- **Invisible overnight charge, UNBOUNDED** (§3.5): trip → silence timeout → pending rest → 10.3 h gap →
  stationary resume with SoC jump → one `charge` with valid `energy_in_kwh`, `bounds:unbounded`,
  `power_avg_kw:null`, `duration_is_charge:false`, `connector_confirmed:true` → fresh `trip`. **Asserts no
  fabricated ~1 kW rate.**
- **Home charge, BOUNDED by meter**: same gap but the charger-meter on/off edges show power on 20:00→23:00
  → `charge` with real `duration_sec`/`power_avg_kw`, `bounds:meter`, `ac_energy_kwh`, `charge_efficiency`.
- **Restart MID-GAP preserves the charge** (blocker-2): pending rest in cache + restart during the 10.3 h
  gap + stationary resume → still one `charge` (Δ computed from persisted pre-gap snapshot), **not** a
  `park`; a stationary resume does **not** prematurely close/split the rest.
- **Restart mid-metered-charge**: meter on-edge persisted, restart during the plugged interval, resume →
  `charge` stays `bounds:meter` (edge survived); a separate test where the persisted on-edge is *absent*
  (started after it) asserts the documented graceful degrade to `bounds:unbounded`, energy still valid.
- **Awake-idle then sleep = ONE rest** (blocker-3): trip closes on `minRestSplitMs` idle → awake-idle rest
  opens → car sleeps → silence timer fires → **no second rest**; resume yields exactly one park/charge.
- **Reboot gap 1–3 min does not split a trip** (moving-both-sides AND ignition-continuity variants).
- **Ignition 1→0 edge** closes the awake session promptly (`closed_by:ignition_edge`).
- **`gear=P` closes the trip immediately** (`closed_by:gear_park`), before `minRestSplitMs` elapses.
- **Stop in gear `D` (red light) does NOT split** the trip even past `minRestSplitMs`; **`gear=N` alone**
  does not split; **gear absent** → falls back to speed + `minRestSplitMs`.
- **Single-sample jitter "trip" rejected** (`< minTripDurationMs` & `< minTripSamples`) → no record, no
  shared-timestamp collision with the following rest.
- **De-dup on `(kind,start_ts,end_ts)`**: a rest whose `start_ts` equals the prior trip's last sample still
  emits (not dropped).
- **Distance honesty**: 1 odometer reading → `distance_km:null` (not 0) and `efficiency:null` (no
  `Infinity`/`NaN`); ≥2 interior readings → distance flagged low `odometer_coverage`.
- **Counter reset** (negative Δ) → metric null; **large legit jump** (60 km trip, bulk charge) → NOT nulled.
- **Missing boundary** (bot starts mid-gap) → `complete:false`, affected metrics null.
- **Park with parasitic drain** → `park`, negative `soc_delta`, sane `soc_drain_pct_per_day`; park shorter
  than `drainMinDurationMs` → drain null.
- **Silence timer** (fake timers) closes at last-sample time, not "now".
- **Emitted-before-publish**: crash after publish/before flush + restart → InfluxDB overwrites (idempotent);
  test asserts the `emitted` marker is set in the pre-publish mutation (Mongo at-least-once is documented,
  not asserted away).
- **Malformed payload** ignored without corrupting state.

Converter unit tests: `ioniq-session.js` maps a session payload to a `ioniq_sessions` point with the `kind`
tag, `start_ts` timestamp, correct field types, **omits null metrics** (no sentinel), and **excludes**
`kind`/`_bot`/`_tz` from fields (§6.2 reserved set).

---

## 9. Delivery — PR granularity

1. **PR1 — the bot.** `docker/automations/bots/ioniq-sessions.js` + tests + `config/automations/config.js`
   wiring. Self-contained; emits to `ioniq/derived/*`. Reviewable and testable in isolation (no InfluxDB
   dependency — pure MQTT-in/MQTT-out). Merged & deployed first; verify records appear on `ioniq/derived/*`
   via `mosquitto_sub` on prod.
2. **PR2 — ingestion.** `docker/mqtt-influx/converters/ioniq-session.js` + `index.js` registration +
   converter tests + the `mqtt-influx-ioniq-sessions` compose service + `docs/influxdb-schema.md` +
   `docker/mqtt-influx/CLAUDE.md` updates. After deploy, confirm `ioniq_sessions` points land in InfluxDB.
3. **PR3 (optional, later) — dashboard.** The "Trips & charging" Grafana dashboard consuming
   `ioniq_sessions`. Out of scope for this spec; listed for sequencing only.

PR1 and PR2 touch disjoint files (automations vs mqtt-influx) and can proceed in parallel; only end-to-end
InfluxDB validation needs both deployed.

## 10. Orchestration & review plan

Per the established ioniq recipe (phase-4 §5):
- All work via **subagents, model/effort-matched**: haiku for mechanical checks, sonnet standard, opus for
  the segmentation-algorithm design gate and final verdicts.
- **Independent fresh subagents at every review gate** (plan review, bot review, converter/bridge review,
  whole-branch review). The author never reviews itself.
- **Escalate to the human only** for genuine product/judgment calls.
- Selective staging only (never `git add .`); every commit body ends with the Claude-Session trailer.
- Each PR ends **OPEN** with a GOOD-TO-MERGE verdict + evidence; the human decides merges.

## 11. Validation (non-negotiable)

- Segmentation logic validated against **real historical windows** replayed from prod (the 4.2-day dump):
  the worked trip and the overnight charge must produce the expected records.
- Every field referenced verified present on prod (recipe below); units confirmed. Already verified:
  `gear` is a string `P/N/D/R` on group **`vmcu`** (`gearParkValue='P'`); charger tiers ~1.2/1.9/2.6 kW with
  0 W baseline over 609 days (`chargerMeterOnW=150`). Re-confirm at implementation that no group/field moved.
- After PR1 deploy: `mosquitto_sub -t 'ioniq/derived/#'` on prod shows well-formed records as the car is
  driven/charged.
- After PR2 deploy: `SELECT * FROM ioniq_sessions` returns the records with correct `kind` tag and
  back-dated timestamps; no InfluxDB write errors in the bridge logs.
- Re-run the §0 data analysis after ~2 weeks and **re-tune thresholds** before considering the bot final.

### Prod read-only query recipe
```
ssh routy 'cd ~/homy && AU=$(cat secrets.local/influxdb_admin_user) AP=$(cat secrets.local/influxdb_admin_password); \
  docker exec homy_influxdb_1 influx -database homy -username "$AU" -password "$AP" -execute "<InfluxQL>"'
```
Creds live in `~/homy/secrets.local/*` (NOT `~/homy/secrets/*`). `"group"` is reserved — double-quote it;
string literals single-quoted; no `$timeFilter` — use explicit `WHERE time >= now() - <window>`.

## 12. Risks & open items

1. **4.2 days of data only** — all thresholds provisional; §11 re-tune is mandatory before "final".
2. **Odometer sparsity (~1/82 min)** makes `distance_km`/efficiency frequently null or coarse. Best fix is
   **logger request §7.1 #1** (denser odometer while driving) — cheap and removes the limitation. Absent
   that, v1 flags it null/low-coverage; a `speed_kph`-integration distance fallback is deliberately deferred
   (integration error). Not blocking.
3. **Charge timing depends on the charger meter (home) or captured edges (away).** Home charges are
   meter-bounded (AC energy + efficiency + real power — verified). **Away-from-home charges** have no meter
   and usually no captured connector edges → `bounds:unbounded`: energy still valid, timing/power null.
   Accepted for v1. **Charger power tiers characterized over 609 days:** three tiers ~1.2 / 1.9 / 2.6 kW
   (the two higher fell out of recent use, hence only 1.2 kW in the 30-day pull), 0 W idle baseline, and
   **no daytime other-load** on the circuit — so the relative `chargerMeterOnW=150 W` threshold detects all
   tiers cleanly. **Calibration path:** the operator can re-exercise all 3 settings and (rarely) a
   powered-mode charge for simultaneous meter + car-side measurements to refine the AC→pack efficiency curve.
   `charge_type` stays `unknown` unless a powered-mode charge decodes it (§4.2).
   - *Known minor approximation (rare `bounds:awake` only):* `power_avg_kw` = whole-rest `energy_in_kwh` ÷
     coverage-span `duration_sec`, so if coverage starts after the rest opens (e.g. a cold-start powered-mode
     charge) the rate can over-estimate. Spec-conformant with §4.2; affects only the no-meter/no-connector
     powered-mode path, never the unbounded/meter/connector paths. A future refinement is to attribute only
     coverage-span energy on this path.
4. **`speed_kph` / `ignition` trustworthiness** — `speedMovingKph` hysteresis mitigates standstill jitter;
   ignition is operator-confirmed trustworthy as the awake delimiter but its 1→0 edge is only *sometimes*
   captured before power-off, so the silence timer remains the backstop. Validate both floors during tuning.
5. **Counter lifetime resets** (MEMORY "look reset") not observable in 4.2 days — the negative-delta guard
   (§5.2) is the safeguard; watch after more history.
6. **Meter↔car time correlation** relies on both being on the same server clock (verified aligned within
   ~5–9 min). A large clock skew would mis-bound a charge; the ±minutes tolerance in matching absorbs the
   handshake/taper lag.
7. **Followup journey bot** (coarse trip merging) and the **Trips & charging dashboard** are separate,
   unblocked-by-this deliverables.

## 13. Acceptance criteria

- `ioniq-sessions` bot emits one well-formed record per closed `trip`/`charge`/`park` to
  `ioniq/derived/{trip,charge,park}`, with §4 metrics + quality metadata; **idempotent into InfluxDB**
  (`kind`+`start_ts`), at-least-once into Mongo with the `emitted` mitigation (§5.5).
- Canonical scenarios pass with fail-before/pass-after: clean trip; **meter-bounded home charge** (real
  power + `ac_energy_kwh` + efficiency); **unbounded away charge** (energy valid, power null, no fabricated
  rate); parasitic-drain park; reboot-gap-does-not-split; awake-idle+sleep = one rest; restart-mid-gap
  preserves the charge; single-sample jitter rejected; distance null-not-zero on sparse odometer.
- Missing-data policy (§5) exercised by tests: null-not-fabricate, session-type-aware lazy-close,
  timer-close at last-sample time, negative-delta-only counter guard, `(kind,start_ts,end_ts)` de-dup.
- `ioniq-session` converter + `mqtt-influx-ioniq-sessions` bridge land records in a new `ioniq_sessions`
  measurement (tag `kind`, back-dated `start_ts`); null metrics omit their field; `_bot`/`_tz`/`kind`
  excluded from fields.
- `docs/influxdb-schema.md`, `docker/mqtt-influx/CLAUDE.md`, and the alerting-spec §7/§10 updates landed.
- Two OPEN PRs (bot, ingestion) each carrying an independent GOOD-TO-MERGE verdict with evidence.
