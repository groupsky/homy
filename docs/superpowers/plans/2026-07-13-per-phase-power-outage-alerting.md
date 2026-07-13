# Per-Phase Power Outage Alerting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Grafana alerts that clearly notify when any single mains phase loses power (naming the phase) and when all phases are lost (total blackout), and stop the existing `ac-alert` from firing confusing noise during outages.

**Architecture:** Two new provisioned Grafana alert-rule YAML files plus one edit to an existing one, all under `config/grafana/provisioning/alerting/`, all routed through the existing `telegram-webhook` contact point → `telegram-bridge` → Telegram. Per-phase loss is detected as `v == 0` while the meter is still reporting; total blackout is detected as `NoData` across the whole `current_power` measurement. No image rebuilds — Grafana mounts these files read-only and (re)loads them on restart.

**Tech Stack:** Grafana 9.5 unified alerting (provisioned YAML, `classic_conditions`), InfluxDB 1.x (InfluxQL), Docker Compose.

**Spec:** `docs/superpowers/specs/2026-07-12-per-phase-power-outage-alerting-design.md`

## Global Constraints

- InfluxDB datasource UID is **`P3C6603E967DC8568`** (verbatim in every data query; expression queries use `datasourceUid: __expr__`).
- InfluxDB database is **`homy`**; measurement **`current_power`**; voltage field **`v`**; tags **`device.name`** (dotted key) and **`phase`** = `A`/`B`/`C`; the mains meter is **`device.name = main`**.
- Alert queries MUST use **`classic_conditions`** for the condition expression (not `threshold`) — per `config/grafana/CLAUDE.md`, `threshold` causes "condition must not be empty" errors in Grafana 9.5 provisioned alerts.
- Raw InfluxQL alert queries MUST include an explicit **`WHERE time >= now() - <duration>`** — `relativeTimeRange` does NOT filter InfluxQL in Grafana 9.5. Do NOT use `$timeFilter`.
- Dead phase reads **exactly `0.0 V`**; live phase reads **227–241 V** (verified from the 2026-07-08 event). Threshold: `v < 50` = dead.
- All new rules use folder **`Webhook Alerting`** and labels `alert_type: webhook` to match existing rules and route through `telegram-webhook`.
- Grafana + InfluxDB have **no published host ports**; reach them with `docker compose --env-file example.env exec <svc> ...`. Grafana admin is `admin`/`admin` (no `[security]` override in `config/grafana/config.ini`).

---

## File Structure

- Create: `config/grafana/provisioning/alerting/phase-power-loss-alert.yaml` — Rule 1 (per-phase loss, names the phase).
- Create: `config/grafana/provisioning/alerting/total-power-outage-alert.yaml` — Rule 2 (total blackout via NoData).
- Modify: `config/grafana/provisioning/alerting/ac-alert.yaml` — exclude `0 V` from the low-voltage branch.
- Modify: `docs/influxdb-schema.md` — document the `current_power` measurement (the alert data source).

Each task validates its YAML and confirms Grafana provisions it without error; a final task verifies end-to-end alert behavior against injected InfluxDB data, and the last task deploys to prod.

---

## Task 1: Rule 1 — Named single-phase loss

**Files:**
- Create: `config/grafana/provisioning/alerting/phase-power-loss-alert.yaml`

**Interfaces:**
- Consumes: InfluxDB measurement `current_power`, field `v`, tags `device.name=main`, `phase`. Datasource UID `P3C6603E967DC8568`.
- Produces: Grafana alert rule uid `webhook-phaseloss01`, one firing instance per dead phase carrying a `phase` label.

- [ ] **Step 1: Create the alert file**

Create `config/grafana/provisioning/alerting/phase-power-loss-alert.yaml` with exactly:

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: Phase power loss webhook
    folder: Webhook Alerting
    interval: 1m
    rules:
      - uid: webhook-phaseloss01
        title: Phase Power Loss (Webhook)
        condition: B
        data:
          - refId: A
            queryType: ''
            relativeTimeRange:
              from: 180
              to: 0
            datasourceUid: P3C6603E967DC8568
            model:
              alias: "$tag_phase"
              groupBy:
                - params: ["$__interval"]
                  type: time
                - params: ["phase"]
                  type: tag
                - params: ["none"]
                  type: fill
              intervalMs: 1000
              maxDataPoints: 43200
              measurement: current_power
              orderByTime: ASC
              policy: default
              resultFormat: time_series
              select:
                - - params: ["v"]
                    type: field
                  - params: []
                    type: last
              tags:
                - key: "device.name"
                  operator: "="
                  value: main
          - refId: B
            queryType: ''
            relativeTimeRange:
              from: 0
              to: 0
            datasourceUid: __expr__
            model:
              datasource:
                type: __expr__
                uid: __expr__
              conditions:
                - evaluator:
                    params: [50]
                    type: lt
                  operator:
                    type: and
                  query:
                    params: [A]
                  reducer:
                    type: last
              intervalMs: 1000
              maxDataPoints: 43200
              type: classic_conditions
        noDataState: OK
        execErrState: OK
        for: 2m
        annotations:
          summary: "⚡ Phase power lost"
          description: "Phase {{ $labels.phase }} of the mains has dropped to 0 V while the meter is still reporting. One or more phases are out; the meter's own supply phase is still live."
        labels:
          rule_uid: webhook-phaseloss01
          alert_type: webhook
```

- [ ] **Step 2: Bring up Grafana + InfluxDB and confirm the rule provisions without error**

Grafana validates the YAML when it loads provisioning; a malformed file or bad rule shows up as an error log line. Run:
```bash
docker compose --env-file example.env up -d influxdb grafana
sleep 15
docker compose --env-file example.env logs grafana 2>&1 | grep -iE "provision.*(error|fail)|failed to (parse|provision).*alert"
```
Expected: **no output** (no provisioning errors). (Optional fast pre-check if `python3`+PyYAML is present: `python3 -c 'import yaml;yaml.safe_load(open("config/grafana/provisioning/alerting/phase-power-loss-alert.yaml"))' && echo YAML_OK`.)

- [ ] **Step 3: Confirm the rule is present**

Run:
```bash
docker compose --env-file example.env exec -T grafana \
  curl -s -u admin:admin http://localhost:3000/api/v1/provisioning/alert-rules | grep -o 'webhook-phaseloss01'
```
Expected: prints `webhook-phaseloss01`.

- [ ] **Step 4: Commit**

```bash
git add config/grafana/provisioning/alerting/phase-power-loss-alert.yaml
git commit -m "feat(alerting): add named per-phase mains power-loss alert"
```

---

## Task 2: Rule 2 — Total blackout (all meters silent)

**Files:**
- Create: `config/grafana/provisioning/alerting/total-power-outage-alert.yaml`

**Interfaces:**
- Consumes: InfluxDB measurement `current_power`, field `v` (any device/phase). Datasource UID `P3C6603E967DC8568`.
- Produces: Grafana alert rule uid `webhook-totalout01`, firing via `noDataState: Alerting` when the whole measurement is silent.

- [ ] **Step 1: Create the alert file**

Create `config/grafana/provisioning/alerting/total-power-outage-alert.yaml` with exactly:

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: Total power outage webhook
    folder: Webhook Alerting
    interval: 1m
    rules:
      - uid: webhook-totalout01
        title: Total Power Outage (Webhook)
        condition: B
        data:
          - refId: A
            queryType: ''
            relativeTimeRange:
              from: 90
              to: 0
            datasourceUid: P3C6603E967DC8568
            model:
              query: 'SELECT last("v") FROM "current_power" WHERE time >= now() - 90s'
              rawQuery: true
              resultFormat: time_series
              intervalMs: 1000
              maxDataPoints: 43200
          - refId: B
            queryType: ''
            relativeTimeRange:
              from: 0
              to: 0
            datasourceUid: __expr__
            model:
              datasource:
                type: __expr__
                uid: __expr__
              conditions:
                - evaluator:
                    params: [-1]
                    type: lt
                  operator:
                    type: and
                  query:
                    params: [A]
                  reducer:
                    type: last
              intervalMs: 1000
              maxDataPoints: 43200
              type: classic_conditions
        noDataState: Alerting
        execErrState: OK
        for: 1m
        annotations:
          summary: "🚨 TOTAL POWER OUTAGE"
          description: "All meters have gone silent — every phase is down (full blackout). Server running on UPS/battery."
        labels:
          rule_uid: webhook-totalout01
          alert_type: webhook
```

Rationale for the `< -1` condition: it can never be true for a real voltage, so while ANY meter reports the rule sits in `Normal`. The real trigger is the query returning no data (total silence) → `noDataState: Alerting` fires. `execErrState: OK` prevents a transient InfluxDB hiccup from false-alarming.

- [ ] **Step 2: Reload provisioning and confirm no errors**

Grafana loads alerting provisioning at startup, so restart it to pick up the new file, then check for errors:
```bash
docker compose --env-file example.env restart grafana
sleep 15
docker compose --env-file example.env logs --since 30s grafana 2>&1 | grep -iE "provision.*(error|fail)|failed to (parse|provision).*alert"
```
Expected: **no output**.

- [ ] **Step 3: Provision check**

Run:
```bash
docker compose --env-file example.env exec -T grafana \
  curl -s -u admin:admin http://localhost:3000/api/v1/provisioning/alert-rules | grep -o 'webhook-totalout01'
```
Expected: prints `webhook-totalout01`.

- [ ] **Step 4: Commit**

```bash
git add config/grafana/provisioning/alerting/total-power-outage-alert.yaml
git commit -m "feat(alerting): add total power outage (all-meters-silent) alert"
```

---

## Task 3: Narrow `ac-alert` to ignore dead phases

**Files:**
- Modify: `config/grafana/provisioning/alerting/ac-alert.yaml` (the `minV` query, lines 42-70)

**Interfaces:**
- Consumes: same `current_power` / `v` data. No new outputs; existing uid `webhook-3057STtVkz` unchanged.

- [ ] **Step 1: Replace the `minV` query with a raw query that excludes 0 V**

In `config/grafana/provisioning/alerting/ac-alert.yaml`, replace the entire `minV` block (the `refId: minV` list item, currently a builder-mode query) with:

```yaml
          - refId: minV
            queryType: ''
            relativeTimeRange:
              from: 300
              to: 0
            datasourceUid: P3C6603E967DC8568
            model:
              alias: "min V"
              # Exclude kitchen (faulty 0V device) AND dead phases (v=0 during an
              # outage) so a phase dropping to 0V no longer trips this generic
              # "voltage out of range" alert — that is now covered by the dedicated
              # phase-power-loss / total-power-outage alerts. Genuine brown-outs
              # (a phase sagging to e.g. 150V, still > 0) are still caught.
              query: 'SELECT min("v") FROM "current_power" WHERE "device.name" != ''kitchen'' AND "v" > 0 AND time >= now() - 300s'
              rawQuery: true
              resultFormat: time_series
              intervalMs: 1000
              maxDataPoints: 43200
```

Leave the `maxV` and `refId: A` (condition) blocks unchanged.

- [ ] **Step 2: Reload provisioning and confirm no errors**

```bash
docker compose --env-file example.env restart grafana
sleep 15
docker compose --env-file example.env logs --since 30s grafana 2>&1 | grep -iE "provision.*(error|fail)|failed to (parse|provision).*alert"
```
Expected: **no output**.

- [ ] **Step 3: Provision check (rule still loads under its original uid)**

Run:
```bash
docker compose --env-file example.env exec -T grafana \
  curl -s -u admin:admin http://localhost:3000/api/v1/provisioning/alert-rules | grep -o 'webhook-3057STtVkz'
```
Expected: prints `webhook-3057STtVkz` (rule still present, now with the narrowed query).

- [ ] **Step 4: Commit**

```bash
git add config/grafana/provisioning/alerting/ac-alert.yaml
git commit -m "fix(alerting): stop ac-alert firing on dead phases (v=0)"
```

---

## Task 4: End-to-end behavioral verification against injected data

This task drives all three rules against a live Grafana + InfluxDB using synthetic data and confirms each reaches the right state. No file changes; this is the acceptance gate. (If any check fails, fix the offending rule file from Task 1–3 and re-run.) **Run all steps in one shell session** — Step 1 exports `$INFLUX_ADMIN`, reused by later steps.

**Files:** none (verification only)

- [ ] **Step 1: Ensure the stack is up and note the admin InfluxDB user**

Run:
```bash
docker compose --env-file example.env up -d influxdb grafana
sleep 15
INFLUX_ADMIN=$(docker compose --env-file example.env exec -T influxdb sh -c 'cat /run/secrets/influxdb_admin_user 2>/dev/null || echo admin')
echo "influx admin user: $INFLUX_ADMIN"
```
Expected: prints a username (the example.env dummy admin user). Password is `secret` (example.env). Use `$INFLUX_ADMIN`/`secret` for writes below.

Firing alerts appear in Grafana's Alertmanager active-alerts endpoint
`/api/alertmanager/grafana/api/v2/alerts` — grepping for a rule's summary text there is a clean binary "is it firing" check (empty output = not firing).

- [ ] **Step 2: Verify NORMAL — all three phases live → no alert firing**

Write live voltages for all three phases, wait for evaluation, and confirm no power alert is firing:
```bash
for P in A B C; do
  docker compose --env-file example.env exec -T influxdb \
    influx -database homy -username "$INFLUX_ADMIN" -password secret \
    -execute "INSERT current_power,device.name=main,phase=$P v=233"
done
sleep 70
docker compose --env-file example.env exec -T grafana \
  curl -s -u admin:admin 'http://localhost:3000/api/alertmanager/grafana/api/v2/alerts' \
  | grep -oE 'Phase power lost|TOTAL POWER OUTAGE'
```
Expected: **no output** (neither power alert is active).

- [ ] **Step 3: Verify PARTIAL — phase B dead → Rule 1 fires naming phase B**

Write A and C live, B at 0 V, hold past the 2-minute `for` window, then check the active alert and its `phase` label:
```bash
for i in $(seq 1 13); do
  docker compose --env-file example.env exec -T influxdb influx -database homy -username "$INFLUX_ADMIN" -password secret \
    -execute 'INSERT current_power,device.name=main,phase=A v=233; INSERT current_power,device.name=main,phase=B v=0; INSERT current_power,device.name=main,phase=C v=233'
  sleep 12
done
docker compose --env-file example.env exec -T grafana \
  curl -s -u admin:admin 'http://localhost:3000/api/alertmanager/grafana/api/v2/alerts' \
  | grep -oE 'Phase power lost|TOTAL POWER OUTAGE|"phase":"[ABC]"'
```
Expected: prints `Phase power lost` and `"phase":"B"`, and does NOT print `TOTAL POWER OUTAGE` (main is still reporting).

- [ ] **Step 4: Verify TOTAL — stop all writes → Rule 2 (total outage) fires via NoData**

Stop writing for longer than the 90 s window + 1 m `for`, then check:
```bash
sleep 160
docker compose --env-file example.env exec -T grafana \
  curl -s -u admin:admin 'http://localhost:3000/api/alertmanager/grafana/api/v2/alerts' \
  | grep -oE 'Phase power lost|TOTAL POWER OUTAGE'
```
Expected: prints `TOTAL POWER OUTAGE` and does NOT print `Phase power lost` (Rule 1's `noDataState` is `OK`, so a silent meter does not trip it).

If `TOTAL POWER OUTAGE` does NOT appear, the `noDataState: Alerting` + `for` path is not firing as expected in this Grafana build — fallback: set that rule's `for: 0s` and rely on the notification policy's `group_wait` (30 s) for debounce; edit `total-power-outage-alert.yaml`, `docker compose --env-file example.env restart grafana`, and re-run this step. Record the outcome.

- [ ] **Step 5: Tear down the local stack**

```bash
docker compose --env-file example.env down
```
Expected: containers removed. (Local test data lived only in the ephemeral InfluxDB volume; no prod impact.)

- [ ] **Step 6: Commit any rule fixes made during verification**

Only if Steps 2–4 required edits:
```bash
git add config/grafana/provisioning/alerting/*.yaml
git commit -m "fix(alerting): adjust power outage rules per behavioral verification"
```

---

## Task 5: Document the `current_power` measurement in the schema doc

**Files:**
- Modify: `docs/influxdb-schema.md`

**Interfaces:** none (documentation).

- [ ] **Step 1: Add a `current_power` section documenting the alert data source**

In `docs/influxdb-schema.md`, under the "Primary Energy Monitoring" area (near the existing `#### `main` Measurement` block around line 74), add a new subsection. The existing `main`-measurement text describes the direct modbus writer and predates the mqtt-influx bridge; add this authoritative description of what the alerts actually query:

```markdown
#### `current_power` Measurement (from mqtt-influx bridges)
**Source**: `mqtt-influx-primary` / `-secondary` / `-tetriary` bridges convert
`/modbus/<bus>/<device>/reading` MQTT messages into instantaneous readings.
**Tag Structure**: `bus` (`primary` | `secondary` | `tetriary`),
`device.name` (e.g. `main`, `boiler`, `heat_pump`, …), `device.type`,
`device.addr`, and `phase` (`A` | `B` | `C`, on 3-phase meters).
**Fields** (float): `v` (phase voltage), `c` (phase current), `p` (phase power).

**Mains identification**: the whole-house grid meter is `bus = primary`,
`device.name = main` (SDM630), publishing per-phase `v`/`c`/`p` tagged
`phase = A/B/C` at ~1 Hz.

**Consumers**: the per-phase power-loss and total-power-outage alerts
(`config/grafana/provisioning/alerting/phase-power-loss-alert.yaml`,
`total-power-outage-alert.yaml`) and the AC voltage-range alert (`ac-alert.yaml`)
query this measurement's `v` field. See
`docs/superpowers/specs/2026-07-12-per-phase-power-outage-alerting-design.md`.
```

Also correct the stale note at the existing `#### `main` Measurement` block: change its `**Tag Structure**: `bus: "main"`, `device: "main"`` line to a pointer: `**Note**: per-phase instantaneous voltage/current/power for the mains is in the `current_power` measurement (`bus: "primary"`, `device.name: "main"`), not here — see below.`

- [ ] **Step 2: Verify the doc renders / links resolve**

Run: `grep -n "current_power Measurement" docs/influxdb-schema.md`
Expected: prints the new heading line.

- [ ] **Step 3: Commit**

```bash
git add docs/influxdb-schema.md
git commit -m "docs(influxdb): document current_power measurement (alert data source)"
```

---

## Task 6: Deploy to prod and confirm live rules

Config-only change (no image rebuild). Prod repo is at `ssh routy:~/homy`; Grafana mounts `config/grafana/provisioning` read-only and loads alerting provisioning on restart.

**Files:** none (deployment).

- [ ] **Step 1: Get the branch merged to `master`** (via the normal PR flow) so prod can pull it. Do not proceed to prod until merged.

- [ ] **Step 2: Pull on prod and restart Grafana**

Run:
```bash
ssh routy 'cd ~/homy && git pull --ff-only && docker compose restart grafana'
```
Expected: fast-forward pull includes the three alerting files; grafana restarts.

- [ ] **Step 3: Confirm the new rules provisioned on prod**

Run:
```bash
ssh routy 'cd ~/homy && docker compose exec -T grafana curl -s -u admin:admin http://localhost:3000/api/v1/provisioning/alert-rules | grep -oE "webhook-(phaseloss01|totalout01)"'
```
Expected: prints both `webhook-phaseloss01` and `webhook-totalout01`.

- [ ] **Step 4: Confirm current live state is sane (all phases up → not firing)**

Run:
```bash
ssh routy 'cd ~/homy && docker compose exec -T grafana curl -s -u admin:admin "http://localhost:3000/api/alertmanager/grafana/api/v2/alerts" | grep -oE "Phase power lost|TOTAL POWER OUTAGE"'
```
Expected: **no output** under normal power (neither alert active). (A real outage will flip them; the next actual event is the true end-to-end test — the resolve message will also confirm delivery when power returns.)

---

## Self-Review Notes

- **Spec coverage:** Rule 1 (Task 1) → "notify on any phase, named"; Rule 2 (Task 2) → "notify on all phases"; ac-alert narrowing (Task 3) → removes the confusing noise the user hit; docs (Task 5) → the `docs/influxdb-schema.md` correction. The "main silent but house powered" Known gap is intentionally unimplemented per the spec's resolved decision.
- **No placeholders:** every YAML file is given in full; every command is concrete with expected output.
- **Verification adapted for declarative config:** because these are provisioned config files (not code), "tests" are YAML-parse validation, Grafana provisioning-API presence checks, and an end-to-end behavioral verification with injected InfluxDB data (Task 4).
- **Key assumption flagged for empirical check:** the total-blackout rule relies on `noDataState: Alerting` + `for: 1m` firing on whole-measurement silence — Task 4 Step 4 verifies this and records a fallback if the build behaves differently.
