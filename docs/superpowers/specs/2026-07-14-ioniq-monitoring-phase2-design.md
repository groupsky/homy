# Ioniq EV Monitoring — Phase 2 Implementation Design

Status: approved for planning · Date: 2026-07-14 · Branch: `feat/ioniq-monitoring-phase2`
Parent spec: [`docs/ioniq-monitoring-alerting-spec.md`](../../ioniq-monitoring-alerting-spec.md) (rollout phase 2)

## 1. Scope

This branch implements **rollout phase 2** of the Ioniq monitoring spec: the highest-value,
lowest-effort slice — Grafana-native alerts, the thin DTC bot, the `Ioniq EV` Grafana folder,
and Ioniq-scoped notification routing.

**In scope**
- Grafana alert rules for §4.1 (non-derived battery), §4.2 (parked 12 V), §4.5 (data-liveness).
- `ioniq-dtc` automations bot (§5, thin) publishing `derived/dtc_count` and direct-flagging DTCs.
- Grafana `derived/dtc_count > 0` rule (§4.4).
- `Ioniq EV` Grafana folder + Ioniq-scoped severity notification routing (§3).

**Out of scope (deferred to later branches / other owners)**
- P0 prerequisites: raw→parsed promotion (`ioniq-logger` #7/#5), Mongo TTL fix and InfluxDB
  retention (prod ops). These are external and do not block this branch's deliverables.
- Computation bots: `ioniq-cell-health`, `ioniq-12v-ldc`, `ioniq-tpms`, `ioniq-charge-guard`
  (spec §4.1 derived rows, §4.2 LDC/fast-delta, §4.3 tires, §4.6 usage) — phase 3.
- Dashboards (§7) — phase 4.
- Any alert whose signal is Mongo-only (see §2 findings) or not yet decoded.

## 2. Prod verification findings (2026-07-14, read-only queries on routy)

Confirmed against the live `ioniq` measurement in prod InfluxDB (db `homy`):

- **Groups present in InfluxDB:** `ambient`, `bms/2101`, `bms/2105`, `cells/1|33|65`,
  `dtc/pending`, `dtc/stored`, `gps`, `odometer`, `tpms`, `vmcu`.
- **`state` tag values:** `active`, `charging`, `parked`.
- **Field names confirmed (spec was correct):** `aux_12v` (NOT `12v`), `isolation_kohm`
  (pinned 1000), `cell_min_v`, `cell_max_v`, `temp_max`, `avail_dis` (pinned 98), `soc` all in
  `bms/2101`; `soh` (=100) and `soc_display` in `bms/2105`. `charging`, `ignition`, `main` are
  numeric **fields**, not tags.
- **DTC shape:** groups `dtc/stored` and `dtc/pending` each carry a `codes` field stored as a
  **JSON string** (`"[]"` when healthy). Grafana cannot parse/count this string → the bot must
  compute the count. This is exactly why `ioniq-dtc` exists.
- **Key gap — no `status`/`bcm`/`obc` in InfluxDB.** These are Mongo-only (raw namespace).
  Consequences for this branch:
  - The §4.5 "status flapping (≥3 offline transitions/h)" alert is **NOT Grafana-expressible**
    and is dropped from phase 2. (Revisit if `ioniq/status` is ever promoted to parsed.)
  - Data-liveness must key off `count("hv_v") FROM "ioniq" WHERE "group"='bms/2101'`, not the LWT.

## 3. Architecture (phase-2 slice)

```
logger ─MQTT─> mqtt-influx-ioniq ─> InfluxDB "ioniq" ─> Grafana rules ─┐
                                                                        ├─> telegram-webhook ─> telegram-bridge ─> Telegram
ioniq-dtc bot ─MQTT─> ioniq/parsed/derived/dtc_count ─> InfluxDB ───────┘   (Grafana path)
        │
        └─HTTP POST {message} ─────────────────────────> telegram-bridge ─> Telegram  (bot direct-flag path)
```

- **Grafana** owns all threshold/liveness queries and their notification delivery.
- **`ioniq-dtc` bot** owns the array logic (`codes.length`), publishes a clean numeric derived
  signal, AND direct-flags on a DTC edge so the message names the actual code(s).

## 4. Component A — Grafana alert rules

Location: `config/grafana/provisioning/alerting/`. All rules follow the canonical
`sunseeker-*` shape: `classic_conditions` (never `threshold`), explicit
`WHERE time >= now() - <window>` (never `$timeFilter`), datasource UID `P3C6603E967DC8568`,
group header `folder: Ioniq EV`, `🚗` prefix in `title`/`summary`, labels
`severity` / `device: ioniq` / `subsystem`. Each warn/crit pair is two separate rules.

### 4.1 `ioniq-battery-alerts.yaml` (subsystem: battery) — §4.1 non-derived only

| uid | Query (field, group) | Condition | Sev | for |
|---|---|---|---|---|
| ioniq-isolation-low | `last(isolation_kohm)` bms/2101 | `< 500` | warning | 10m |
| ioniq-isolation-critical | `last(isolation_kohm)` bms/2101 | `< 100` | critical | 10m |
| ioniq-cell-min-low | `last(cell_min_v)` bms/2101 | `< 3.0` | warning | 1m |
| ioniq-cell-min-critical | `last(cell_min_v)` bms/2101 | `< 2.5` | critical | 1m |
| ioniq-cell-max-critical | `last(cell_max_v)` bms/2101 | `> 4.15` | critical | 1m |
| ioniq-pack-temp-high | `last(temp_max)` bms/2101 | `> 45` | warning | 5m |
| ioniq-pack-temp-critical | `last(temp_max)` bms/2101 | `> 55` | critical | 5m |
| ioniq-soh-step | `last(soh)` bms/2105 | `< 98` | warning | 1h |
| ioniq-soh-critical | `last(soh)` bms/2105 | `< 85` | critical | 1h |
| ioniq-avail-dis-derate | `last(avail_dis)` AND `last(soc)` bms/2101 | `avail_dis < 70` AND `soc > 30` | warning | 15m |

SoH uses the v1 **static** baseline (spec §4.1 note); rolling baseline is deferred. The
`avail-dis-derate` rule uses two data queries (`avail_dis`, `soc`, both in bms/2101) combined in
one `classic_conditions` with two ANDed conditions.

### 4.2 `ioniq-12v-alerts.yaml` (subsystem: 12v) — §4.2 parked only

| uid | Query | Condition | Sev | for |
|---|---|---|---|---|
| ioniq-12v-low-parked | `last(aux_12v)` bms/2101, `WHERE "state"='parked'` | `< 12.2` | warning | 30s |
| ioniq-12v-critical-parked | `last(aux_12v)` bms/2101, `WHERE "state"='parked'` | `< 11.8` | critical | 30s |

State filter is an InfluxQL `AND "state"='parked'` in the WHERE clause. This suppresses the
"12.9 V float under heavy traction is normal" false positive (only evaluates parked samples).
LDC-not-charging and fast-delta (§4.2 bot rows) are deferred to phase 3.

### 4.3 `ioniq-connectivity-alerts.yaml` (subsystem: connectivity) — §4.5

TPMS "box powers off ~60 s after lock" means a naive silence alert fires on every park. The
liveness rules use a **two-window** query so they only fire when telemetry *should* be flowing
(recent activity present) but the fast tier has gone silent:

| uid | Logic | Sev | for |
|---|---|---|---|
| ioniq-telemetry-gap | `count(hv_v)` in last 15m `< 1` AND `count(hv_v)` in prior 15–45m window `> 0` | warning | 15m |
| ioniq-telemetry-silent | `count(hv_v)` in last 30m `< 1` AND prior 30–90m window `> 0` | warning | 30m |

Both use `count()` over `bms/2101`; the "prior window" is a second data query with
`WHERE time >= now() - Xm AND time <= now() - Ym`. `noDataState: NoData` (no data at all ≠ alert;
the gate query going empty means the car was already parked, correctly no alert). The
status-flapping rule is dropped (§2: `status` is Mongo-only). Thresholds/windows are tunable.

### 4.4 `ioniq-dtc-alerts.yaml` (subsystem: dtc) — §4.4

| uid | Query | Condition | Sev | for |
|---|---|---|---|---|
| ioniq-dtc-present | `last(value)` `WHERE "group"='derived/dtc_count'` | `> 0` | critical | 0s |

Reads the bot's derived signal. Fires immediately (`for: 0`). Per the "both notify" decision,
this Grafana notification fires **in addition to** the bot's direct-flag; the Grafana message
carries the count, the bot's message names the codes.

## 5. Component B — `ioniq-dtc` bot

Files: `docker/automations/bots/ioniq-dtc.js` + `docker/automations/bots/ioniq-dtc.test.js`,
registered in `config/automations/config.js`.

**Signature:** `module.exports = (name, config) => ({ persistedCache, start })` (repo pattern).

**Subscribes** (exact topics — bot routing is exact-match, wildcards don't work):
`ioniq/parsed/dtc/stored` and `ioniq/parsed/dtc/pending`.

**State:** holds last-known `codes` array for each of stored/pending (combined =
`stored.codes ∪ pending.codes`). `persistedCache` (version 1) persists the last-emitted code set
so a restart doesn't re-flag an already-known DTC.

**On each message:**
1. Update the relevant (stored|pending) code list; compute `count = |stored ∪ pending|`.
2. **Publish** `ioniq/parsed/derived/dtc_count` as
   `{_type:'ioniq', group:'derived/dtc_count', state, ts, value: count, codes: [...]}`
   (`_type:'ioniq'` is required for the mqtt-influx bridge to accept it; `value` is the numeric
   alert input; `codes` passes the list through for history/dashboards).
3. **Direct-flag on 0→N edge** (new codes appear vs. persisted set): HTTP `POST` to
   `config.telegramWebhookUrl` (default `http://telegram-bridge:3000/webhook`) with
   `{message: "🚗 DTC present: <code>, <code> (stored/pending)"}`. Edge-triggered + persisted-set
   dedupe so it flags on appearance, not on every sample. Message uses HTML (`<b>`) per bridge.

**Config fields:** `storedTopic`, `pendingTopic`, `outputTopic`, `telegramWebhookUrl`,
`flagOnEdge` (bool, default true), plus standard `enabled`/`verbose`.

**Testing (TDD, Jest, mocked MQTT + mocked HTTP):**
- Empty `codes` → publishes `value: 0`, no flag.
- Codes appear → publishes correct count + codes, POSTs a message naming the codes.
- Same codes persist across samples → publishes each sample but flags only once (dedupe).
- Codes clear (N→0) → publishes `value: 0`, no flag; a later re-appearance flags again.
- stored and pending combine (union, de-duplicated count).
- Restart with persisted set → no re-flag of already-known codes.
- HTTP POST failure is caught/logged and does not crash the bot (publish still happens).

HTTP uses Node's built-in `http` (no new dependency), mocked in tests.

## 6. Component C — notification routing (Ioniq-scoped)

Edit `config/grafana/provisioning/alerting/notification-policies.yaml`: keep the existing flat
root policy (all house alerts unchanged, 4h repeat) and add a `routes:` array whose entries match
`device = ioniq` + `severity`, `continue: false`, giving Ioniq alerts their own cadence:

- `device = ioniq, severity = critical` → group_wait 10s, group_interval 1m, repeat 1h.
- `device = ioniq, severity = warning` → group_wait 1m, group_interval 5m, repeat 12h.
- `device = ioniq, severity = info` → group_wait 5m, group_interval 30m, repeat 24h.

All still terminate at the existing `telegram-webhook` receiver. **Zero blast radius** on
non-Ioniq alerts (they never match `device = ioniq` and fall through to the root default).

## 7. Component D — contact point

Reuse the existing `telegram-webhook` contact point unchanged. A dedicated Ioniq Telegram chat
is **not possible** without `telegram-bridge` code changes (single global chat id — verified), so
v1 differentiates via the `🚗` prefix in every rule summary and the bot's message text.

## 8. Testing & verification strategy

- **Bot:** `cd docker/automations && npm test` — full TDD per §5, red-green-refactor.
- **Grafana YAML:** validated for structure against the canonical `sunseeker-*` shape;
  provisioning correctness is verified by rule-file structure review (no live Grafana in CI).
- **Subagent reviews:** each component (bot, each alert file group, routing) gets an independent
  subagent code review before merge, per the repo's requesting-code-review flow.
- **InfluxDB queries** were pre-validated against prod data shapes (§2) so no rule silently
  matches nothing.

## 9. Deliverables checklist

- [ ] `config/grafana/provisioning/alerting/ioniq-battery-alerts.yaml`
- [ ] `config/grafana/provisioning/alerting/ioniq-12v-alerts.yaml`
- [ ] `config/grafana/provisioning/alerting/ioniq-connectivity-alerts.yaml`
- [ ] `config/grafana/provisioning/alerting/ioniq-dtc-alerts.yaml`
- [ ] `config/grafana/provisioning/alerting/notification-policies.yaml` (Ioniq routes added)
- [ ] `docker/automations/bots/ioniq-dtc.js` + `.test.js`
- [ ] `config/automations/config.js` (register `ioniq-dtc`)
- [ ] `example.env` / `secrets/` updates if any new config surfaces (none expected — webhook URL
      has an in-code default)
- [ ] Docs: update `docs/influxdb-schema.md` for the new `derived/dtc_count` group; note phase-2
      status in the parent spec.
