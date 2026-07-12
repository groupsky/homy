# Per-Phase Power Outage Alerting — Design

**Date:** 2026-07-12
**Status:** Approved design (pending implementation plan)
**Author:** Geno Roupsky (with Claude Code)

## Problem

A grid outage that left only one of the three mains phases live was hard to
diagnose from existing alerts and data. The user wants:

1. A **clear notification when power is lost on any of the three phases** (and,
   where possible, which phase).
2. A **distinct, clear message when power is lost on all three phases** (total
   blackout).

The existing alerting does neither:

- `main-power-alert.yaml` fires only on **excess** consumption (`> 10 kW`) and
  uses `noDataState: NoData`, so a silent meter is silently ignored.
- `ac-alert.yaml` is a global min/max voltage rule (`< 210 V` or `> 248 V`)
  across meters (excluding `kitchen`). A dead phase trips its low branch, but it
  is reported as a generic "AC voltage out of range" with **no phase identity** —
  the direct cause of the confusion during the real event.

## Verified facts (from the 2026-07-08 event on prod)

Confirmed by querying InfluxDB (`homy` database, `homy_influxdb_1` container) for
the real outage on 2026-07-08 (~11:00 UTC onward). See the July timeline at the
end of this document.

- **Binary voltage signal.** A dead phase reads **exactly `0.0 V`** (not NULL, not
  a sag); a live phase reads **227–241 V**. Any threshold in between separates
  them with a huge margin — `v < 50` = dead, `v > 200` = live.
- **The main meter goes fully silent when it loses its own supply.** During the
  partial outage (phases A & B at 0 V, phase C ~233 V) the SDM630 `main` meter
  kept publishing and reported the dead phases as `0 V`. When its supply phase
  also died, the meter **stopped publishing entirely (a hard data gap / NoData)**,
  rather than publishing zeros.
  - Observed: the meter survived on phase C alone. It is **not confirmed** whether
    the meter can also run from phase A or B alone — so the design does **not**
    assume any specific supply phase.
- **Sample cadence ~1 Hz.** `main` publishes roughly once per second per phase.
  A data gap of **> 30–60 s** is unambiguously a real outage, not a comms blip.
- **Shortest genuine state ~12 min** (a brief full-restoration island between two
  total outages). A **1–2 min debounce (`for:`)** is safe and will not split real
  states.
- **`main` sits electrically upstream of every other meter** (it is the grid
  entry / whole-house metering point; all other meters are downstream branches).
  Consequences that drive the alert classification:
  - Any power reaching a downstream meter must pass through main's location.
    Therefore **`main` silent while a downstream meter still reports ⇒ power is
    present ⇒ it is a `main`-meter fault** (Modbus/comms drop or hardware), **not**
    a power outage.
  - **`main` + every downstream meter silent ⇒ genuine total blackout.** This
    invariant needs no per-meter phase mapping.
- **Witness meters** (downstream, self-powered from their own circuit, so their
  continued reporting proves both "power present" and "that phase live"):
  - `stab-em` (OR-WE-516, `monitoring2`) and single-phase sub-meters (`boiler`,
    `laundry`, `oven`, `stove`, `microwave`, `water_pump`, `dishwasher`).
  - `heat_pump` (3-phase, `dds024mr`) went silent at the **same instant** as
    `main` during the event → it shares `main`'s supply phase. This makes it a
    **co-phase witness**: it can distinguish "the phase powering `main` genuinely
    died (heat_pump also silent)" from "`main` has a comms/hardware fault
    (heat_pump still reporting)". Useful for the edge case below.

## Data source

- Measurement: **`current_power`** (written by the `mqtt-influx-primary` bridge).
- Field: **`v`** (per-phase L–N voltage, float).
- Tags: **`device.name` = `main`**, **`phase` = `A` / `B` / `C`**, `bus = primary`.
- Delivery: Grafana webhook contact point `telegram-webhook` →
  `telegram-bridge` service → Telegram (unchanged; all new rules reuse it).

## Design

Two new Grafana alert rules plus one cleanup, all in
`config/grafana/provisioning/alerting/`, all routed through the existing
`telegram-webhook` contact point. The InfluxDB datasource UID is
`P3C6603E967DC8568` (same as every other alert).

### Grafana constraint that shaped this design

In Grafana's provisioned unified alerting, if any query in a rule returns **no
data**, the whole rule evaluates to `NoData` — you **cannot** express "series X is
absent AND series Y is present" in one rule (the absent series poisons it to
NoData). This rules out a clean "main silent AND a witness still reporting"
condition. Consequently:

- "A phase is dead" is detected as `v == 0` **while the meter is still reporting**
  (Rule 1).
- "Everything is silent" is detected via `NoData` on the whole measurement
  (Rule 2, total blackout).
- The in-between "main silent but house still powered" case (a pure main
  comms/hardware fault, or loss of *only* the phase that powers `main`) is **not
  separately alerted in this iteration** — see Known gaps.

### Rule 1 — Named single-phase loss (meter still alive)

New file: `config/grafana/provisioning/alerting/phase-power-loss-alert.yaml`.

- **Query (refId `A`, builder mode, mirrors `main-power-alert.yaml`):**
  measurement `current_power`, `SELECT last("v")`, `GROUP BY time($__interval),
  "phase" fill(none)`, tag filter `"device.name" = main`, `alias: "$tag_phase"`,
  `relativeTimeRange.from: 180` (3 min lookback). One series per phase A/B/C.
- **Condition (refId `B`, `classic_conditions`):** `last(A) < 50` → firing. Because
  the data is grouped by the `phase` tag, Grafana produces **one alert instance per
  phase**, each carrying a `phase` label.
- **`for`:** `2m`. **`noDataState`:** `OK` (total blackout is Rule 2's job; Rule 1
  must stay quiet when the meter is silent). **`execErrState`:** `OK`.
- **Message:** summary `⚡ Phase power lost`, description
  `Phase {{ index $labels "phase" }} of the mains has dropped to 0 V while the
  meter is still reporting. One or more phases are out; other phases are still
  live.`
- **Covers:** any phase the meter can still see going dead while the meter's own
  supply phase remains up — the core "which phase is out" answer.

### Rule 2 — Total blackout (all meters silent)

New file: `config/grafana/provisioning/alerting/total-power-outage-alert.yaml`.

- **Query (refId `A`, raw InfluxQL):** `SELECT last("v") FROM "current_power"
  WHERE time >= now() - 90s` — any meter, any phase, across the whole measurement.
  (`rawQuery: true`; explicit `WHERE time >= now() - 90s` per the Grafana 9.5
  provisioned-alert rule that `relativeTimeRange` does not filter InfluxQL.)
- **Condition (refId `B`, `classic_conditions`):** `last(A) < -1` — an evaluator
  that is **never true for a real voltage**, so the rule sits in `Normal` whenever
  *any* meter is reporting.
- **The real trigger is NoData.** When the entire `current_power` measurement goes
  silent (every meter unpowered = full blackout) the query returns no data →
  `noDataState: Alerting` fires. **`execErrState`:** `OK` (so a transient InfluxDB
  hiccup does not false-alarm; InfluxDB is on the same UPS-backed host).
- **`for`:** `1m` (≫ the ~1 s sample cadence, so a comms blip cannot trip it).
- **Message:** summary `🚨 TOTAL POWER OUTAGE`, description `All meters have gone
  silent — every phase is down (full blackout). Server running on UPS/battery.`
- Fires **only** on true total silence: during a partial outage `main` still
  reports, and during a main-only fault the downstream meters still report, so in
  both those cases the query returns data and this rule stays `Normal`.

### Rule 3 (cleanup) — Narrow `ac-alert`

Modify `config/grafana/provisioning/alerting/ac-alert.yaml`.

- Change the `minV` query's tag filter so `0 V` readings are excluded from the
  `< 210 V` low branch — add a second tag condition `"v" > 1` is not expressible on
  a value in the builder, so instead exclude dead phases at the source: change the
  low-branch **query** to select the minimum voltage **above 0** by adding a raw
  `WHERE "v" > 0` clause (convert `minV` to `rawQuery: true`:
  `SELECT min("v") FROM "current_power" WHERE "device.name" != 'kitchen' AND "v" > 0
  AND time >= now() - 300s`). This stops `ac-alert` firing a vague "AC voltage out
  of range" every time a phase drops to 0 V — that job now belongs to Rules 1–2 —
  while it still catches genuine brown-out (a phase sagging to, say, 150 V) and
  over-voltage.

### Docs

- Update `docs/influxdb-schema.md`: it currently documents the mains as
  `bus:"main"` / `device:"main"` / measurement `main`. The real schema is
  `bus:"primary"`, tag key `device.name = main`, measurements `current_power`
  (instantaneous `v`/`c`/`p` with `phase` tag) and `power_meter` (cumulative kWh).

## Behavior summary

| Real-world state                          | `main` meter | Other meters   | Alert fired                          |
|-------------------------------------------|--------------|----------------|--------------------------------------|
| All phases live                           | publishing   | publishing     | none                                 |
| One/two non-supply phases dead            | publishing, dead phase = 0 V | any | **Rule 1** — names the phase(s)      |
| `main` silent, house still powered (main comms/hardware fault, **or** only the phase powering `main` is lost) | silent | ≥1 publishing | **none** (Known gap) |
| All three phases dead                      | silent       | all silent     | **Rule 2** — total blackout          |

Grafana sends resolve messages (`disableResolveMessage: false`) so each state also
produces a recovery notification when it clears.

## Alert tuning constants

- Dead/live voltage threshold: **`v < 50`** (dead; margin to live ~227 V).
- Total-blackout liveness window: **`now() - 90s`** (≫ the ~1 s sample cadence).
- Debounce: **`for: 2m`** (Rule 1), **`for: 1m`** (Rule 2).

## Known gaps (accepted this iteration)

- **`main` silent while the house is still powered is not alerted.** This covers
  (a) a pure `main` Modbus/comms or hardware fault with power present, and (b) loss
  of *only* the phase that powers `main` while other phases stay up. Grafana cannot
  cleanly express "main absent AND a witness present" (see the constraint above),
  so no rule fires for this state. It has not been observed standalone — in the
  July event, every time the meter's phase died it was part of a full blackout,
  which **is** caught by Rule 2. If this case ever bites in practice, the natural
  fix is a small `automations` bot that tracks meter liveness (deferred).

## Resolved decisions

- **Rule 2 "main meter fault": DROPPED this iteration.** Rules 1 (per-phase loss)
  and the total-blackout rule fully cover the two explicit asks ("any phase" and
  "all phases"). The main-fault / co-phase-witness detection is left as the future
  bot enhancement noted in Known gaps.

## Out of scope

- Automating any recovery action (power-cycling, load shedding).
- Changing the meter's physical wiring or adding hardware witnesses.
- Migrating delivery off the existing webhook → telegram-bridge path.

## Reference: 2026-07-08/09 event timeline (UTC)

```
JUL 8
 10:35:40  Phase A & B -> 0 V; C stays ~233 V   [PARTIAL begins; meter still publishing]
 10:35     stab-em + boiler/laundry/microwave/oven/stove/water_pump go silent (dead phases)
 11:00:33  Meter goes silent                     [TOTAL begins — phase C lost]   gap ~2h18m
 13:18:45  All 3 phases back ~232–235 V          [FULL restore, ~12 min]
 13:30:37  Meter goes silent                     [TOTAL again]                    gap ~2h56m
 16:26:31  All 3 phases back, stable thereafter
JUL 9
 06:16:27  Meter goes silent                     [TOTAL — no partial captured]    gap ~1h46m
 08:02:46  All 3 phases back, stable thereafter
```
