# Ioniq EV Overview Dashboard (PR1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver `ioniq-overview.json` plus the "Ioniq EV" Grafana folder and the shared dashboard template that PR2's four sibling dashboards will clone verbatim.

**Architecture:** Hand-authored provisioned Grafana JSON (`allowUiUpdates: false` ⇒ no UI-built dashboards). A new subdirectory under `config/grafana/dashboards/` becomes the Grafana folder title via the provider's `foldersFromFilesStructure: true`. All panels query InfluxDB v1 over InfluxQL against measurement `ioniq` in database `homy`. Validation runs a throwaway local Grafana 9.5.21 container against **real prod data** through a read-only SSH tunnel — prod is never written to and the branch is never provisioned onto the prod Grafana.

**Tech Stack:** Grafana 9.5.21 (`schemaVersion: 37`), InfluxDB v1 / InfluxQL, Docker, SSH port-forwarding.

## Global Constraints

Every task's requirements implicitly include this section. These are **verified ground truth** from
`docs/superpowers/plans/2026-07-15-ioniq-phase4-dashboards-build-brief.md`. Do not re-derive or contradict them.

- **InfluxQL only** (InfluxDB v1). Never Flux, never SQL.
- **Datasource reference is always the object form**, at panel level *and* inside every `targets[]` entry:
  `{"type": "influxdb", "uid": "P3C6603E967DC8568"}`. Never a bare string.
- **Target style is "Style A"** (raw InfluxQL string): `datasource` + `query` + `rawQuery: true` + `refId`.
  Do **not** use `heatpump.json`'s builder-style `select`/`groupBy`/`tags`/`measurement` metadata.
- **Quoting:** `"group"` is a reserved word — always double-quote it. Dotted fields are quoted as one whole
  unit (`"fl.psi"`, never `fl."psi"`, never bare `fl.psi`). String literals are single-quoted (`'tpms'`).
- **`km` is overloaded.** `odometer`.`km` = 174650 (lifetime) vs `range_est`.`km` = ~145.6 (remaining range) —
  same field, same measurement. **Every `km` query MUST filter `"group"='odometer'`.** Verified 2026-07-15: an
  unscoped `SELECT last("km")` returns **145.6 (range_est)**, not the odometer.
- **Never use `count()` for liveness.** An empty window returns **no row at all** while the car sleeps.
  Liveness is `last()` + timestamp.
- **Gauge:** unit is `"percent"` (0–100 scale; `percentunit` is for 0.0–1.0). `minVizWidth`, `minVizHeight`
  and `sizing` **do not exist in 9.5.21** — including them is an error.
- **Alertlist:** filters by folder **TITLE** (`"folder": {"title": "Ioniq EV"}`); `sortOrder` is a numeric
  enum; the panel sets `skipDataQuery: true` so it takes **no `datasource` and no `targets`**.
- **Series naming — use target `alias`, never `byName` overrides on an InfluxQL column.** The 9.5.21
  InfluxQL **frontend** parser names each series `<measurement>.<column>` unless the column is literally
  `value`: `let o=n.name; const u=n.columns[a]; u!=="value"&&(o=o+"."+u)`. So
  `SELECT last("soc") AS "soc" FROM "ioniq"` yields a series named **`ioniq.soc`**, and a
  `{"matcher":{"id":"byName","options":"soc"}}` override **silently never matches**. (The Go backend parser
  behaves differently, but it is gated behind the `influxdbBackendMigration` feature toggle, which is off by
  default in 9.5.21 — the frontend path is what renders.)
  **Set the display name with the target's `"alias"` field instead.** It is immune to the column-naming rule
  and self-documenting.
  ⚠️ **`sunseeker-overview.json`'s `AS "battery"` + `byName: "battery"` override (line ~553) is itself dead
  code by this same rule — do NOT copy that idiom.** The sunseeker panels that actually work alias
  `AS "value"`, which is precisely the `u!=="value"` escape hatch. PR2 must follow `alias`, not the
  sunseeker precedent.
- **Top-level key order** is alphabetical, exactly as Grafana exports:
  `annotations, description, editable, fiscalYearStartMonth, graphTooltip, id, links, liveNow, panels,
  refresh, schemaVersion, style, tags, templating, time, timepicker, timezone, title, uid, version, weekStart`.
- **Fixed template values:** `id: null`, `editable: true`, `style: "dark"`, `schemaVersion: 37`,
  `templating: {"list": []}`, `liveNow: false`, `graphTooltip: 0`, `fiscalYearStartMonth: 0`, `version: 1`,
  `weekStart: ""`, `timezone: ""`, `timepicker: {}`.
- **Tags:** `["ioniq", "ev", "vehicle"]` on every dashboard in the family.
- **Deliberate deviations from existing sunseeker files — do NOT "correct" these back:**
  1. **Tag-based nav** (`"type": "dashboards"` filtered to tag `ioniq`), not hardcoded `/d/<uid>` links.
  2. **`refresh: "1m"`** (sunseeker uses `30s`, heatpump `5s`). The spec's claim that `1m` is the "repo
     standard" is inaccurate, but `1m` is the right call and is approved.
  3. **Overview time range `now-24h`** (the real sunseeker overview uses `now-6h`). Follow the spec.
- **Panel-description duty:** where a signal is legitimately flat, frozen, or sparse, the panel
  `description` must say so, so a reviewer never misreads healthy data as "no data".
- **Git:** selective staging only — **never `git add .`** (the repo carries many unrelated untracked files).
  Every commit body ends with exactly:
  `Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN`
- **Prod is read-only.** SELECT/SHOW only. Never DROP/DELETE/INSERT/ALTER/CREATE. Never deploy to prod.

### ⚠️ Correction to the build brief — `finished to provision dashboards` does not exist in 9.5.21

Brief §6 requires evidence that *"Grafana log shows `finished to provision dashboards`"*. **That log line does
not exist in Grafana 9.5.21.** A binary string search of `/usr/share/grafana/bin/grafana` yields only:

```
starting to provision alerting
finished to provision alerting
```

There is **no dashboards variant** — the dashboard provisioner logs nothing equivalent on success. Grepping
for it therefore always returns empty, which would either read as a false failure or tempt an executor to
fudge the evidence.

The brief instructs that its facts be challenged **loudly with evidence** rather than silently worked around,
so: this is a brief error, and it must be reported as such in the PR verdict. **Substitute evidence that
actually exists** (all confirmed working):
1. `GET /api/search?type=dash-db` lists `ioniq-overview` with `"folderTitle": "Ioniq EV"` — proves the
   dashboard provisioned AND landed in the right folder, which is strictly stronger than the log line.
2. `GET /api/folders` shows the `Ioniq EV` folder.
3. A **negative** check: no `logger=provisioning.dashboard` error lines, and no ioniq errors in the log.

### Verified prod values (2026-07-15, read-only) — panels must render these

| Panel | Query (CLI form; dashboards use `$timeFilter`) | Verified value |
|---|---|---|
| SoC | `SELECT last("soc") FROM "ioniq" WHERE "group"='bms/2101'` | 52 |
| SoC display | `SELECT last("soc_display") FROM "ioniq" WHERE "group"='bms/2105'` | 54 |
| Pack V | `SELECT last("hv_v") FROM "ioniq" WHERE "group"='bms/2101'` | 351.7 |
| Pack A | `SELECT last("hv_a") FROM "ioniq" WHERE "group"='bms/2101'` | 3.1 |
| Pack kW | `SELECT last("hv_kw") FROM "ioniq" WHERE "group"='bms/2101'` | 1.09027 |
| 12 V | `SELECT last("aux_12v") FROM "ioniq" WHERE "group"='bms/2101'` | 13.5 |
| DTC | `SELECT last("value") FROM "ioniq" WHERE "group"='derived/dtc_count'` | 0 |
| Odometer | `SELECT last("km") FROM "ioniq" WHERE "group"='odometer'` | 174650 |
| Tires | `SELECT last("fl.psi") FROM "ioniq" WHERE "group"='tpms'` (+ fr/rl/rr) | 37 / 35.4 / 35.8 / 36.2 |

24 h window carries **3135** `soc` points ⇒ the `now-24h` default renders populated, not empty.

### Threshold bands — mirror the shipped alert rules (do not invent new numbers)

Read from `config/grafana/provisioning/alerting/ioniq-*.yaml`:

- **12 V:** critical `< 11.8`, low `< 12.2` ⇒ steps `red(null) → orange(11.8) → green(12.2)`.
- **Tires:** critical `< 26`, low `< 30`, over-inflated `> 42` ⇒ steps
  `red(null) → orange(26) → green(30) → red(42)`.
- **DTC:** alerts `> 0` ⇒ steps `green(null) → red(1)`.
- **SoC:** `red(null) → orange(20) → green(50)`.

---

## File Structure

| Path | Responsibility |
|---|---|
| `config/grafana/dashboards/Ioniq EV/ioniq-overview.json` | **Create.** The Overview dashboard AND the canonical template PR2 clones. The directory name is the mechanism that produces the "Ioniq EV" folder title. |
| `docs/superpowers/plans/2026-07-15-ioniq-phase4-dashboards-build-brief.md` | **Create** (copy of the currently-untracked brief). PR2 depends on it; it would otherwise be lost. |
| `docs/superpowers/plans/2026-07-15-ioniq-overview-dashboard.md` | **Create.** This plan. |

Nothing else is touched. `config/grafana/provisioning/**` is **not** modified — the existing provider already
does folders-from-file-structure. `docker/automations/**` is PR0's territory and is out of scope.

The validation harness (tunnel + local Grafana) lives **only in the scratchpad** and is deliberately **not
committed** — it is a throwaway dev tool, not a deliverable.

---

## Task 1: Stand up the validation harness (local Grafana 9.5.21 + read-only prod tunnel)

Nothing is committed in this task. Its deliverable is a working live Grafana that proves the harness itself
is trustworthy **before** any ioniq JSON exists — so that a later "No data" can never be blamed on the rig.

**Files:**
- Create: `<SCRATCH>/run-grafana.sh` (scratchpad only, never committed)

Where `<SCRATCH>` = `/tmp/claude-1000/-home-groupsky-src-homy/d695e82d-a3b5-4299-b9d8-692285b6c3ac/scratchpad`.

**Interfaces:**
- Produces: a local Grafana at `http://127.0.0.1:13000` (admin/admin) provisioning **the repo's real**
  `config/grafana/provisioning` and `config/grafana/dashboards` from the **worktree**, with its InfluxDB
  datasource proxying to prod through an SSH tunnel using the **read-only** user.

- [ ] **Step 1: Open the SSH tunnel to prod InfluxDB**

InfluxDB is **not** port-published on routy; it sits on the internal `automation` docker network, so the
tunnel must target the container IP.

**The tunnel must bind BOTH `127.0.0.1` and the docker bridge address.** A bare `-L 18086:...` binds
`127.0.0.1` only, but the Grafana container reaches the host via `host.docker.internal` →
`host-gateway` → `172.17.0.1` (docker0). A listener bound to `127.0.0.1` does **not** accept connections on
`172.17.0.1`, so a single-bind tunnel makes every panel render "No data" while the host-side `curl` checks
still pass — a silent, maximally confusing failure. Verified: container → host-gateway on a 127.0.0.1-bound
port = connection refused; on a 172.17.0.1-bound port = `204`.

Binding both keeps the host-side checks (Steps 2 and 4, which use `127.0.0.1:18086`) working AND lets the
container in.

```bash
IP=$(ssh routy 'docker inspect -f "{{range .NetworkSettings.Networks}}{{.IPAddress}} {{end}}" homy_influxdb_1' | awk '{print $1}')
echo "influx container ip: $IP"
# confirm the bridge address the container will use
BRIDGE=$(docker network inspect bridge -f '{{(index .IPAM.Config 0).Gateway}}')
echo "docker bridge gateway: $BRIDGE"   # expect 172.17.0.1

ssh -f -N -L 127.0.0.1:18086:$IP:8086 -L $BRIDGE:18086:$IP:8086 routy
```

- [ ] **Step 2: Verify the tunnel is live**

```bash
curl -s "http://127.0.0.1:18086/ping" -o /dev/null -w "%{http_code}\n"
```
Expected: `204`

- [ ] **Step 3: Fetch the read-only credentials**

Real creds live in `secrets.local/`, **not** `secrets/`.

```bash
RU=$(ssh routy 'cat ~/homy/secrets.local/influxdb_read_user')
RP=$(ssh routy 'cat ~/homy/secrets.local/influxdb_read_user_password')
echo "read user: $RU"   # never echo the password
```

- [ ] **Step 4: Verify the read-only user can query prod through the tunnel**

The InfluxQL mixes double quotes (identifiers) and single quotes (literals), which shell quoting mangles.
Build the query in a variable with a heredoc so neither quote type needs escaping.

```bash
read -r -d '' Q <<'EOF'
SELECT last("soc") FROM "ioniq" WHERE "group"='bms/2101' AND time > now() - 24h
EOF
curl -s -G "http://127.0.0.1:18086/query" \
  --data-urlencode "db=homy" \
  --data-urlencode "u=$RU" --data-urlencode "p=$RP" \
  --data-urlencode "q=$Q"
```
Expected: JSON containing a `soc` value around `52` and a recent timestamp. If this fails, **stop** — the
harness is broken and nothing downstream can be trusted.

- [ ] **Step 5: Write the harness script**

Uses the GHCR base image (repo policy; also dodges Docker Hub rate limits). Mounts the **worktree's**
provisioning and dashboards exactly where prod mounts them, so the real provider config
(`foldersFromFilesStructure: true`) is exercised rather than a hand-made substitute. Telegram vars are
deliberately bogus: the alerting provisioning references them, and a bogus token means any notification
attempt fails harmlessly instead of paging a human.

```bash
cat > "$SCRATCH/run-grafana.sh" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

REPO="${REPO:?set REPO to the worktree root}"
RU="${RU:?read user}"
RP="${RP:?read password}"

docker rm -f ioniq-val-grafana >/dev/null 2>&1 || true

docker run -d --name ioniq-val-grafana \
  --add-host host.docker.internal:host-gateway \
  -p 13000:3000 \
  -e GF_SECURITY_ADMIN_USER=admin \
  -e GF_SECURITY_ADMIN_PASSWORD=admin \
  -e INFLUXDB_URL=http://host.docker.internal:18086 \
  -e INFLUXDB_DATABASE=homy \
  -e INFLUXDB_USER="$RU" \
  -e INFLUXDB_USER_PASSWORD="$RP" \
  -e TELEGRAM_BOT_TOKEN=000:bogus-local-validation-token \
  -e TELEGRAM_CHAT_ID=0 \
  -v "$REPO/config/grafana/provisioning":/etc/grafana/provisioning:ro \
  -v "$REPO/config/grafana/dashboards":/var/lib/grafana/dashboards:ro \
  ghcr.io/groupsky/homy/grafana:9.5.21

echo "waiting for grafana..."
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:13000/api/health || true)
  [ "$code" = "200" ] && { echo "grafana healthy after ${i}s"; exit 0; }
  sleep 1
done
echo "grafana did not become healthy" >&2
docker logs ioniq-val-grafana 2>&1 | tail -40 >&2
exit 1
EOF
chmod +x "$SCRATCH/run-grafana.sh"
```

- [ ] **Step 6: Run the harness and verify Grafana is healthy**

```bash
SCRATCH=/tmp/claude-1000/-home-groupsky-src-homy/d695e82d-a3b5-4299-b9d8-692285b6c3ac/scratchpad
REPO="$(git rev-parse --show-toplevel)" RU="$RU" RP="$RP" "$SCRATCH/run-grafana.sh"
```
Expected: `grafana healthy after Ns`

- [ ] **Step 7: Prove the harness is trustworthy BEFORE any ioniq JSON exists**

The datasource must actually reach prod, and the **pre-existing** dashboards must provision cleanly. This is
the control experiment.

```bash
# datasource proxies to prod
curl -s -u admin:admin "http://127.0.0.1:13000/api/datasources/name/influxdb" | head -c 400; echo
# existing dashboards provisioned
curl -s -u admin:admin "http://127.0.0.1:13000/api/search?type=dash-db" | tr ',' '\n' | grep -i title
# the datasource can actually reach prod THROUGH the container (proves the tunnel bind is right)
curl -s -u admin:admin -G "http://127.0.0.1:13000/api/datasources/proxy/1/query" \
  --data-urlencode "db=homy" \
  --data-urlencode 'q=SHOW MEASUREMENTS LIMIT 3'
# no provisioning errors
docker logs ioniq-val-grafana 2>&1 | grep -iE "logger=provisioning.*(error|failed)" || echo "NO PROVISIONING ERRORS"
```
Expected: the datasource exists with `"type":"influxdb"`; the sunseeker/heatpump dashboards are listed; the
proxied `SHOW MEASUREMENTS` returns real measurement names (**this is the step that catches a wrongly-bound
tunnel** — if it errors, fix Task 1 Step 1 before going further); and `NO PROVISIONING ERRORS`.

Do **not** grep for `finished to provision dashboards` — see the correction in Global Constraints; that line
does not exist in 9.5.21.

- [ ] **Step 8: No commit**

This task commits nothing. The harness is scratchpad-only by design.

---

## Task 2: Create the "Ioniq EV" folder + the canonical template skeleton

**This task locks the shape PR2 clones.** It ships a valid, provisionable dashboard with `panels: []` so the
folder-title mechanism and the template are proven **in isolation**, before any panel can confound the result.

**Files:**
- Create: `config/grafana/dashboards/Ioniq EV/ioniq-overview.json`

**Interfaces:**
- Produces: the canonical top-level skeleton + the tag-based nav `links` block. Every PR2 dashboard clones
  this verbatim, changing only `description`, `panels`, `time.from` (`now-6h` for detail dashboards), `title`
  and `uid`.

- [ ] **Step 1: Create the directory and write the skeleton**

The directory name is literally `Ioniq EV`, spaces included — the provider turns the directory name into the
folder title, and the title must match the alert folder (`folder: Ioniq EV`) exactly for the alertlist panel
to filter correctly. Step 3 verifies this empirically rather than trusting it.

```bash
mkdir -p "config/grafana/dashboards/Ioniq EV"
```

```json
{
  "annotations": {
    "list": [
      {
        "builtIn": 1,
        "datasource": {
          "type": "datasource",
          "uid": "grafana"
        },
        "enable": true,
        "hide": true,
        "iconColor": "rgba(0, 211, 255, 1)",
        "name": "Annotations & Alerts",
        "target": {
          "limit": 100,
          "matchAny": false,
          "tags": [],
          "type": "dashboard"
        },
        "type": "dashboard"
      }
    ]
  },
  "description": "Hyundai Ioniq Electric — at-a-glance status: state of charge, HV pack V/A/kW, 12 V auxiliary battery, diagnostic trouble codes, telemetry last-seen, odometer, tire pressures and active alerts.",
  "editable": true,
  "fiscalYearStartMonth": 0,
  "graphTooltip": 0,
  "id": null,
  "links": [
    {
      "asDropdown": true,
      "icon": "external link",
      "includeVars": false,
      "keepTime": true,
      "tags": [
        "ioniq"
      ],
      "targetBlank": false,
      "title": "Ioniq EV",
      "tooltip": "Other Ioniq EV dashboards",
      "type": "dashboards",
      "url": ""
    }
  ],
  "liveNow": false,
  "panels": [],
  "refresh": "1m",
  "schemaVersion": 37,
  "style": "dark",
  "tags": [
    "ioniq",
    "ev",
    "vehicle"
  ],
  "templating": {
    "list": []
  },
  "time": {
    "from": "now-24h",
    "to": "now"
  },
  "timepicker": {},
  "timezone": "",
  "title": "🚗 Ioniq EV – Overview",
  "uid": "ioniq-overview",
  "version": 1,
  "weekStart": ""
}
```

Note: the title uses an **en dash** (`–`, U+2013), not a hyphen — matching the spec's table verbatim.

- [ ] **Step 2: Verify the JSON is valid and the key order is canonical**

```bash
python3 -m json.tool "config/grafana/dashboards/Ioniq EV/ioniq-overview.json" > /dev/null && echo "JSON OK"
python3 -c "import json;print(list(json.load(open('config/grafana/dashboards/Ioniq EV/ioniq-overview.json')).keys()))"
```
Expected: `JSON OK`, then exactly:
`['annotations', 'description', 'editable', 'fiscalYearStartMonth', 'graphTooltip', 'id', 'links', 'liveNow', 'panels', 'refresh', 'schemaVersion', 'style', 'tags', 'templating', 'time', 'timepicker', 'timezone', 'title', 'uid', 'version', 'weekStart']`

- [ ] **Step 3: Restart Grafana and VERIFY THE RENDERED FOLDER TITLE**

This is the gate the whole folder mechanism rests on. Do **not** assume a spaced directory name renders as
intended — read it back from the API.

```bash
docker restart ioniq-val-grafana && sleep 15
# the folder as Grafana actually created it
curl -s -u admin:admin "http://127.0.0.1:13000/api/folders"
# the dashboard and the folder title it landed in
curl -s -u admin:admin "http://127.0.0.1:13000/api/search?query=Ioniq"
```
Expected: a folder whose `"title"` is **exactly** `Ioniq EV`, and the search result for `ioniq-overview`
showing `"folderTitle":"Ioniq EV"`.

**If the folder title is wrong:** do not paper over it. Adjust and re-verify. The documented fallback, if a
spaced directory name proves unworkable, is to add a **second provider entry** in
`config/grafana/provisioning/dashboards/dashboards.yaml` scoped to the ioniq subdir with an explicit
`folder: Ioniq EV` — which decouples the folder title from the directory name. Do **not** set `folder:` on the
existing provider: it would relocate *every* dashboard in the repo.

- [ ] **Step 4: Verify provisioning is clean**

```bash
docker logs ioniq-val-grafana 2>&1 | grep -iE "logger=provisioning.dashboard" | grep -iE "error|failed" || echo "NO DASHBOARD PROVISIONING ERRORS"
docker logs ioniq-val-grafana 2>&1 | grep -iE "error|failed" | grep -i ioniq || echo "NO IONIQ ERRORS"
```
Expected: `NO DASHBOARD PROVISIONING ERRORS` and `NO IONIQ ERRORS`. (The positive evidence that the dashboard
provisioned is Step 3's API read-back, not a log line — see the Global Constraints correction.)

- [ ] **Step 5: Verify the nav link block round-trips**

```bash
curl -s -u admin:admin "http://127.0.0.1:13000/api/dashboards/uid/ioniq-overview" \
  | python3 -c "import json,sys;d=json.load(sys.stdin)['dashboard'];print('links:',json.dumps(d['links']));print('tags:',d['tags']);print('refresh:',d['refresh']);print('time:',d['time'])"
```
Expected: the `links` entry with `"type": "dashboards"` and `"tags": ["ioniq"]`; tags
`['ioniq', 'ev', 'vehicle']`; refresh `1m`; time from `now-24h`.

- [ ] **Step 6: Commit**

```bash
git add "config/grafana/dashboards/Ioniq EV/ioniq-overview.json"
git commit -m "$(cat <<'EOF'
feat(ioniq): Ioniq EV dashboard folder + shared template skeleton

Adds the "Ioniq EV" dashboards subdirectory, whose name the provisioning
provider (foldersFromFilesStructure: true) renders as the Grafana folder
title — matching the Phase-2 alert folder so the Overview's alertlist can
filter on it.

Establishes the canonical template the rest of the family clones:
alphabetically ordered top-level keys, schemaVersion 37, dark style, the
["ioniq","ev","vehicle"] tags, and tag-based navigation (a dashboards link
filtered to tag "ioniq") so siblings auto-populate the nav as they land
rather than needing hardcoded /d/<uid> links maintained across PRs.

Verified against a local Grafana 9.5.21 provisioning this tree: rendered
folder title reads exactly "Ioniq EV".

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
EOF
)"
```

---

## Task 3: SoC gauge + HV pack V/A/kW + 12 V stats

**Files:**
- Modify: `config/grafana/dashboards/Ioniq EV/ioniq-overview.json` (the `panels` array)

**Interfaces:**
- Consumes: the Task 2 skeleton.
- Produces: panel ids 1–5 occupying grid `y=0`, `x=0..17`.

Grid plan for the whole dashboard (24 columns), for reference across Tasks 3–6.

**Tiles are w=6, not w=3.** A w=3 tile is ~225 px at a normal viewport, which **truncates the panel titles**
("Pack Volt…", "12 V Batt…", "DTC Stat…"). The values render fine either way, so this is invisible to an API
read-back — only a real render catches it. PR2 clones these conventions, so they are worth getting right.

| id | panel | x | y | w | h |
|---|---|---|---|---|---|
| 1 | State of Charge (gauge) | 0 | 0 | 6 | 6 |
| 2 | Pack Voltage | 6 | 0 | 6 | 3 |
| 3 | Pack Current | 12 | 0 | 6 | 3 |
| 4 | Pack Power | 18 | 0 | 6 | 3 |
| 5 | 12 V Battery | 6 | 3 | 6 | 3 |
| 6 | DTC Status | 12 | 3 | 6 | 3 |
| 7 | Last Seen | 18 | 3 | 6 | 3 |
| 8 | Odometer | 0 | 6 | 8 | 3 |
| 9–12 | Tires FL/FR/RL/RR | 8/12/16/20 | 6 | 4 | 3 |
| 13 | Active Alerts (alertlist) | 0 | 9 | 24 | 6 |

The SoC gauge (h=6) spans rows y=0–5, sitting beside both stat rows. Every row fills exactly 24/24 columns
with no overlaps. The `gridPos` blocks in the panel JSON below use these values.

- [ ] **Step 1: Add panels 1–5 to the `panels` array**

The gauge carries **two** targets, so both series must be named — without disambiguation both come back as
`ioniq.last` and collide.

Naming is done with the target **`alias`** field, NOT with `byName` overrides. Per the Global Constraints,
`SELECT last("soc") AS "soc"` produces a series named `ioniq.soc` (measurement-dot-column), so a
`byName: "soc"` override would silently never match and the gauge would render the raw `ioniq.soc` /
`ioniq.soc_display` labels. `alias` sets the displayed name directly and is immune to that rule.
The `AS "soc"` in the SQL is kept because it makes the raw query self-describing, but the **`alias` is what
labels the gauge**.

```json
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Traction battery state of charge. \"SoC (BMS)\" is the true pack SoC (bms/2101); \"SoC (dash)\" is the driver-facing value (bms/2105) and normally reads a few percent higher — that offset is expected, not an error.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 0,
          "mappings": [],
          "max": 100,
          "min": 0,
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 20
              },
              {
                "color": "green",
                "value": 50
              }
            ]
          },
          "unit": "percent"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 6,
        "w": 6,
        "x": 0,
        "y": 0
      },
      "id": 1,
      "options": {
        "orientation": "auto",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "showThresholdLabels": false,
        "showThresholdMarkers": true
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "alias": "SoC (BMS)",
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"soc\") AS \"soc\" FROM \"ioniq\" WHERE \"group\"='bms/2101' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        },
        {
          "alias": "SoC (dash)",
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"soc_display\") AS \"soc_display\" FROM \"ioniq\" WHERE \"group\"='bms/2105' AND $timeFilter",
          "rawQuery": true,
          "refId": "B"
        }
      ],
      "title": "State of Charge",
      "type": "gauge"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "High-voltage traction pack voltage (bms/2101 hv_v).",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 1,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "blue",
                "value": null
              }
            ]
          },
          "unit": "volt"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 6,
        "x": 6,
        "y": 0
      },
      "id": 2,
      "options": {
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"hv_v\") AS \"hv_v\" FROM \"ioniq\" WHERE \"group\"='bms/2101' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Pack Voltage",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "High-voltage pack current (bms/2101 hv_a).",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 1,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "blue",
                "value": null
              }
            ]
          },
          "unit": "amp"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 6,
        "x": 12,
        "y": 0
      },
      "id": 3,
      "options": {
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"hv_a\") AS \"hv_a\" FROM \"ioniq\" WHERE \"group\"='bms/2101' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Pack Current",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Instantaneous HV pack power (bms/2101 hv_kw), equal to hv_v × hv_a / 1000.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 2,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "blue",
                "value": null
              }
            ]
          },
          "unit": "kwatt"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 6,
        "x": 18,
        "y": 0
      },
      "id": 4,
      "options": {
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"hv_kw\") AS \"hv_kw\" FROM \"ioniq\" WHERE \"group\"='bms/2101' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Pack Power",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Auxiliary 12 V battery (bms/2101 aux_12v). Bands mirror the shipped Ioniq 12 V alert rules: red below 11.8 V (critical), orange below 12.2 V (low), green above. Readings near 13.5 V mean the LDC is actively charging the 12 V battery — that is healthy.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 1,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 11.8
              },
              {
                "color": "green",
                "value": 12.2
              }
            ]
          },
          "unit": "volt"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 6,
        "x": 6,
        "y": 3
      },
      "id": 5,
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"aux_12v\") AS \"aux_12v\" FROM \"ioniq\" WHERE \"group\"='bms/2101' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "12 V Battery",
      "type": "stat"
    }
```

- [ ] **Step 2: Validate JSON**

```bash
python3 -m json.tool "config/grafana/dashboards/Ioniq EV/ioniq-overview.json" > /dev/null && echo "JSON OK"
```
Expected: `JSON OK`

- [ ] **Step 3: Restart Grafana and read the panel data back**

Query each panel's target through the Grafana datasource proxy and confirm it returns the verified prod value.

```bash
docker restart ioniq-val-grafana && sleep 15
q() { curl -s -u admin:admin -G "http://127.0.0.1:13000/api/datasources/proxy/1/query" \
        --data-urlencode "db=homy" --data-urlencode "q=$1"; }
q 'SELECT last("soc") AS "soc" FROM "ioniq" WHERE "group"='"'"'bms/2101'"'"' AND time > now() - 24h'
q 'SELECT last("soc_display") AS "soc_display" FROM "ioniq" WHERE "group"='"'"'bms/2105'"'"' AND time > now() - 24h'
q 'SELECT last("hv_v") AS "hv_v" FROM "ioniq" WHERE "group"='"'"'bms/2101'"'"' AND time > now() - 24h'
q 'SELECT last("hv_a") AS "hv_a" FROM "ioniq" WHERE "group"='"'"'bms/2101'"'"' AND time > now() - 24h'
q 'SELECT last("hv_kw") AS "hv_kw" FROM "ioniq" WHERE "group"='"'"'bms/2101'"'"' AND time > now() - 24h'
q 'SELECT last("aux_12v") AS "aux_12v" FROM "ioniq" WHERE "group"='"'"'bms/2101'"'"' AND time > now() - 24h'
```
Expected: soc ≈ 52, soc_display ≈ 54, hv_v ≈ 351.7, hv_a ≈ 3.1, hv_kw ≈ 1.09, aux_12v ≈ 13.5.
(The datasource numeric id is `1` in a fresh instance; confirm via
`curl -s -u admin:admin http://127.0.0.1:13000/api/datasources | python3 -m json.tool | grep -E '"id"|"uid"'`.)

- [ ] **Step 4: Verify the gauge LABELS render, not just the values**

This is the regression guard for the series-naming rule. Open `http://127.0.0.1:13000/d/ioniq-overview` and
read the gauge.

Expected: the two gauges are labelled **"SoC (BMS)"** and **"SoC (dash)"**.
**If they read `ioniq.soc` / `ioniq.soc_display`, the `alias` is not taking effect — stop and fix it.** Do not
"fix" it by adding a `byName` override on `soc`: that override can never match (see Global Constraints), and
shipping it would teach PR2 a broken idiom.

- [ ] **Step 5: Verify provisioning stayed clean**

```bash
docker logs ioniq-val-grafana 2>&1 | grep -iE "error|failed" | grep -i ioniq || echo "NO IONIQ ERRORS"
```
Expected: `NO IONIQ ERRORS`

- [ ] **Step 6: Commit**

```bash
git add "config/grafana/dashboards/Ioniq EV/ioniq-overview.json"
git commit -m "$(cat <<'EOF'
feat(ioniq): overview SoC gauge + HV pack and 12 V stats

SoC gauge shows both the true pack SoC (bms/2101) and the driver-facing
display SoC (bms/2105); the two targets are named because otherwise both
series come back as "ioniq.last" and collide.

Naming uses the target alias field, not byName field overrides. The 9.5.21
InfluxQL frontend parser names series <measurement>.<column> unless the
column is literally "value", so an override matching "soc" would silently
never fire and the gauge would show raw "ioniq.soc" labels. (This is why
sunseeker-overview.json's byName: "battery" override is dead code — that
idiom is deliberately not cloned here, since PR2 inherits this template.)

The 12 V bands are not invented — they mirror the shipped ioniq-12v alert
rules (critical < 11.8 V, low < 12.2 V) so the dashboard and the alerts can
never disagree about what "low" means.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
EOF
)"
```

---

## Task 4: DTC status + Last-seen + Odometer stats

**Files:**
- Modify: `config/grafana/dashboards/Ioniq EV/ioniq-overview.json` (append to `panels`)

**Interfaces:**
- Consumes: Task 3's panels array.
- Produces: panel ids 6, 7, 8.

**Odometer unit — use `"suffix: km"`, NOT `"lengthkm"`.** Grafana's `lengthkm` is `SIPrefix('m', 1)`, i.e. it
SI-rescales the value: 174650 km renders as **"175 Mm"** (megameters), which is both unreadable and looks like
a broken query. Verified by render. `"suffix: km"` renders `174650 km`. Ironically the group-scope guard works
perfectly here — this unit bug would have made a *correct* odometer look wrong.

The **last-seen** panel is the subtle one. It reduces the frame's **`Time`** field (not the value field) and
formats it as a relative age. Verified against the Grafana source at tag v9.5.21:

- `fieldDisplay.ts:109-116` — time fields are **not** auto-skipped; the matcher is the only gate
  (the source comment literally reads *"To filter out time field, need an option for this"*).
- `fieldDisplay.ts:86-95` — a non-empty `reduceOptions.fields` string ⇒ `FieldMatcherID.byRegexp`, and
  `/^[Tt]ime$/` parses as a regex via `stringToJsRegex`.
- `fieldState.ts:70-74` — the time field's display name short-circuits to the plain `"Time"`.
- `displayProcessor.ts:37,49-52` — `dateTimeFromNow` is in the `timeFormats` map, so the explicit unit is
  **not** clobbered by the `dateTimeAsSystem` fallback.
- `fieldOverrides.ts:200-202` — Grafana explicitly disables display caching for `dateTimeFromNow`, proving
  this is an intended use case.

Three gotchas, all mandatory (each verified in that source):
1. `"graphMode": "none"` — otherwise the sparkline plots Time against Time (a meaningless 45° line).
2. `"colorMode": "none"` — the reduced value is an epoch (~1.75e12), which blows past any threshold, so the
   default `colorMode: "value"` would render the text permanently red.
3. No `defaults.displayName` — with `textMode: "auto"` it would flip to value-and-name and print "Time".

The regex is `/^[Tt]ime$/` rather than `/^Time$/` deliberately: the frontend InfluxQL parser names the field
`Time`, but the Go backend parser names it lowercase `time`. Matching both keeps the panel from silently
breaking if the `influxdbBackendMigration` feature toggle is ever enabled.

- [ ] **Step 1: Append panels 6, 7, 8**

```json
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Number of active diagnostic trouble codes (derived/dtc_count). 0 = healthy, and a green \"No DTCs\" is the normal steady state. Any value above 0 also raises the Ioniq DTC alert.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 0,
          "mappings": [
            {
              "options": {
                "0": {
                  "color": "green",
                  "index": 0,
                  "text": "No DTCs"
                }
              },
              "type": "value"
            }
          ],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "green",
                "value": null
              },
              {
                "color": "red",
                "value": 1
              }
            ]
          },
          "unit": "none"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 6,
        "x": 12,
        "y": 3
      },
      "id": 6,
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"value\") AS \"dtc_count\" FROM \"ioniq\" WHERE \"group\"='derived/dtc_count' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "DTC Status",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Age of the newest BMS telemetry sample, from the timestamp of last(soc) on bms/2101. The car only reports while awake, so an age of hours is normal while it sleeps and does NOT mean the pipeline is broken. Liveness is deliberately derived from last() plus its timestamp rather than count(): an empty window returns no row at all, so a count()-based panel would go blank exactly when the car is asleep.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "text",
                "value": null
              }
            ]
          },
          "unit": "dateTimeFromNow"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 6,
        "x": 18,
        "y": 3
      },
      "id": 7,
      "options": {
        "colorMode": "none",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "/^[Tt]ime$/",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"soc\") FROM \"ioniq\" WHERE \"group\"='bms/2101' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Last Seen",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Lifetime distance travelled (odometer km). NOTE: the km field is overloaded in this measurement — range_est also carries a km field (~146, the remaining-range estimate). This query is scoped to \"group\"='odometer' for that reason; verified 2026-07-15, an unscoped last(\"km\") returns range_est's 145.6 rather than the odometer's 174650.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 0,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "blue",
                "value": null
              }
            ]
          },
          "unit": "suffix: km"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 8,
        "x": 0,
        "y": 6
      },
      "id": 8,
      "options": {
        "colorMode": "value",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"km\") AS \"odometer\" FROM \"ioniq\" WHERE \"group\"='odometer' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Odometer",
      "type": "stat"
    }
```

- [ ] **Step 2: Validate JSON**

```bash
python3 -m json.tool "config/grafana/dashboards/Ioniq EV/ioniq-overview.json" > /dev/null && echo "JSON OK"
```
Expected: `JSON OK`

- [ ] **Step 3: Verify the odometer is group-scoped (regression guard for the km trap)**

```bash
grep -o 'SELECT last(\\"km\\")[^"]*' "config/grafana/dashboards/Ioniq EV/ioniq-overview.json"
```
Expected: the match contains `\"group\"='odometer'`. If any `km` query lacks that filter, the panel is wrong.

- [ ] **Step 4: Restart and verify the three panels return real data**

```bash
docker restart ioniq-val-grafana && sleep 15
q() { curl -s -u admin:admin -G "http://127.0.0.1:13000/api/datasources/proxy/1/query" \
        --data-urlencode "db=homy" --data-urlencode "q=$1"; }
q 'SELECT last("value") AS "dtc_count" FROM "ioniq" WHERE "group"='"'"'derived/dtc_count'"'"' AND time > now() - 24h'
q 'SELECT last("km") AS "odometer" FROM "ioniq" WHERE "group"='"'"'odometer'"'"' AND time > now() - 24h'
q 'SELECT last("soc") FROM "ioniq" WHERE "group"='"'"'bms/2101'"'"' AND time > now() - 24h'
```
Expected: dtc_count = 0; odometer = 174650 (**not** ~145.6 — that would mean the group scope was lost);
the soc row carries a recent timestamp, which is what the Last Seen panel formats.

- [ ] **Step 5: Verify the Last Seen panel renders a relative time, not "No data"**

This is the step that proves the time-field reduction actually works. Render the panel and read the text.

```bash
curl -s -u admin:admin "http://127.0.0.1:13000/api/dashboards/uid/ioniq-overview" \
  | python3 -c "import json,sys;d=json.load(sys.stdin)['dashboard'];p=[x for x in d['panels'] if x['id']==7][0];print(json.dumps(p['options'],indent=2));print('unit:',p['fieldConfig']['defaults']['unit'])"
```
Expected: `fields` is `/^[Tt]ime$/`, `colorMode` is `none`, `graphMode` is `none`, unit is `dateTimeFromNow`.
Then confirm visually in the browser (Task 7 captures the screenshot): the panel must read something like
"26 minutes ago", **not** "No data" and not a red epoch number. If it shows "No data", stop and reassess —
do not ship a broken liveness panel.

- [ ] **Step 6: Commit**

```bash
git add "config/grafana/dashboards/Ioniq EV/ioniq-overview.json"
git commit -m "$(cat <<'EOF'
feat(ioniq): overview DTC, last-seen and odometer stats

The odometer target is scoped to "group"='odometer' because the km field is
overloaded: range_est carries a km field too (~146 = remaining range vs
174650 = lifetime distance). Verified against prod — an unscoped last("km")
returns 145.6, i.e. it silently renders a range estimate labelled as total
distance.

The odometer unit is "suffix: km" rather than Grafana's lengthkm, which is
an SI-prefixed metre unit and rescales 174650 km to an unreadable "175 Mm".

Last-seen reduces the frame's Time field with unit dateTimeFromNow rather
than counting samples: count() over an empty window returns no row at all,
so a count()-based liveness panel goes blank precisely when the car sleeps,
which is when liveness matters most. graphMode/colorMode are pinned to none
because the reduced value is an epoch — it would otherwise plot Time against
Time and colour the text permanently red.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
EOF
)"
```

---

## Task 5: Four tire-pressure stats

**Files:**
- Modify: `config/grafana/dashboards/Ioniq EV/ioniq-overview.json` (append to `panels`)

**Interfaces:**
- Consumes: Task 4's panels array.
- Produces: panel ids 9–12.

These read the **parsed** flat `tpms` fields (`"fl.psi"` …), which the mqtt-influx converter flattens at write
time. They are queryable **today** and are therefore **independent of PR0** — only the PR2 `ioniq-tires`
dashboard's `derived/tire_*` signals depend on that bot fix.

- [ ] **Step 1: Append panels 9–12**

Bands mirror the shipped tpms alert rules: critical `< 26`, low `< 30`, over-inflated `> 42`.
Grafana threshold steps are ascending lower bounds, so `red(null) → orange(26) → green(30) → red(42)` yields
red below 26, orange 26–30, green 30–42, red above 42.

Known cosmetic edge: the alert is `gt 42` (strict) while a Grafana step at 42 colours `>= 42`, so exactly
42.0 psi shows red without alerting. Accepted — a one-sided boundary at an exact tenth is not worth a
threshold fudge, and the conservative direction (colour before alert) is the right one.

```json
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Front-left tire pressure (tpms \"fl.psi\"), via last(). TPMS only transmits while the wheels turn, so this stays frozen at its last reading while the car is parked — expected, not stale. Bands mirror the shipped Ioniq TPMS alerts: red below 26 psi (critical) or above 42 psi (over-inflated), orange below 30 psi (low), green 30–42 psi.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 1,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 26
              },
              {
                "color": "green",
                "value": 30
              },
              {
                "color": "red",
                "value": 42
              }
            ]
          },
          "unit": "pressurepsi"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 4,
        "x": 8,
        "y": 6
      },
      "id": 9,
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"fl.psi\") AS \"fl_psi\" FROM \"ioniq\" WHERE \"group\"='tpms' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Tire FL",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Front-right tire pressure (tpms \"fr.psi\"), via last(). TPMS only transmits while the wheels turn, so this stays frozen at its last reading while the car is parked — expected, not stale. Bands mirror the shipped Ioniq TPMS alerts: red below 26 psi (critical) or above 42 psi (over-inflated), orange below 30 psi (low), green 30–42 psi.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 1,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 26
              },
              {
                "color": "green",
                "value": 30
              },
              {
                "color": "red",
                "value": 42
              }
            ]
          },
          "unit": "pressurepsi"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 4,
        "x": 12,
        "y": 6
      },
      "id": 10,
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"fr.psi\") AS \"fr_psi\" FROM \"ioniq\" WHERE \"group\"='tpms' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Tire FR",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Rear-left tire pressure (tpms \"rl.psi\"), via last(). TPMS only transmits while the wheels turn, so this stays frozen at its last reading while the car is parked — expected, not stale. Bands mirror the shipped Ioniq TPMS alerts: red below 26 psi (critical) or above 42 psi (over-inflated), orange below 30 psi (low), green 30–42 psi.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 1,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 26
              },
              {
                "color": "green",
                "value": 30
              },
              {
                "color": "red",
                "value": 42
              }
            ]
          },
          "unit": "pressurepsi"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 4,
        "x": 16,
        "y": 6
      },
      "id": 11,
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"rl.psi\") AS \"rl_psi\" FROM \"ioniq\" WHERE \"group\"='tpms' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Tire RL",
      "type": "stat"
    },
    {
      "datasource": {
        "type": "influxdb",
        "uid": "P3C6603E967DC8568"
      },
      "description": "Rear-right tire pressure (tpms \"rr.psi\"), via last(). TPMS only transmits while the wheels turn, so this stays frozen at its last reading while the car is parked — expected, not stale. Bands mirror the shipped Ioniq TPMS alerts: red below 26 psi (critical) or above 42 psi (over-inflated), orange below 30 psi (low), green 30–42 psi.",
      "fieldConfig": {
        "defaults": {
          "color": {
            "mode": "thresholds"
          },
          "decimals": 1,
          "mappings": [],
          "thresholds": {
            "mode": "absolute",
            "steps": [
              {
                "color": "red",
                "value": null
              },
              {
                "color": "orange",
                "value": 26
              },
              {
                "color": "green",
                "value": 30
              },
              {
                "color": "red",
                "value": 42
              }
            ]
          },
          "unit": "pressurepsi"
        },
        "overrides": []
      },
      "gridPos": {
        "h": 3,
        "w": 4,
        "x": 20,
        "y": 6
      },
      "id": 12,
      "options": {
        "colorMode": "background",
        "graphMode": "none",
        "justifyMode": "center",
        "orientation": "horizontal",
        "reduceOptions": {
          "calcs": [
            "lastNotNull"
          ],
          "fields": "",
          "values": false
        },
        "textMode": "auto"
      },
      "pluginVersion": "9.5.2",
      "targets": [
        {
          "datasource": {
            "type": "influxdb",
            "uid": "P3C6603E967DC8568"
          },
          "query": "SELECT last(\"rr.psi\") AS \"rr_psi\" FROM \"ioniq\" WHERE \"group\"='tpms' AND $timeFilter",
          "rawQuery": true,
          "refId": "A"
        }
      ],
      "title": "Tire RR",
      "type": "stat"
    }
```

- [ ] **Step 2: Validate JSON**

```bash
python3 -m json.tool "config/grafana/dashboards/Ioniq EV/ioniq-overview.json" > /dev/null && echo "JSON OK"
```
Expected: `JSON OK`

- [ ] **Step 3: Restart and verify all four tires return real data**

```bash
docker restart ioniq-val-grafana && sleep 15
q() { curl -s -u admin:admin -G "http://127.0.0.1:13000/api/datasources/proxy/1/query" \
        --data-urlencode "db=homy" --data-urlencode "q=$1"; }
for w in fl fr rl rr; do
  echo "--- $w ---"
  q "SELECT last(\"$w.psi\") AS \"${w}_psi\" FROM \"ioniq\" WHERE \"group\"='tpms' AND time > now() - 24h"
done
```
Expected: fl ≈ 37, fr ≈ 35.4, rl ≈ 35.8, rr ≈ 36.2 — all four green (30–42 band).
A parse error here means the dotted-field quoting is wrong.

- [ ] **Step 4: Commit**

```bash
git add "config/grafana/dashboards/Ioniq EV/ioniq-overview.json"
git commit -m "$(cat <<'EOF'
feat(ioniq): overview per-wheel tire pressure stats

Reads the parsed tpms fields ("fl.psi" etc.) that the mqtt-influx converter
flattens at write time, so these render today and do not depend on the
in-flight tpms bot fix — only the PR2 tires dashboard's derived/tire_*
signals do.

Each dotted field is quoted as a single whole identifier; bare fl.psi would
parse as measurement-dot-field. Bands mirror the shipped tpms alert rules
(critical < 26, low < 30, over-inflated > 42).

Pressures stay frozen while parked because TPMS only transmits while the
wheels turn; the panel descriptions say so, so a frozen reading is not
misread as a broken feed.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
EOF
)"
```

---

## Task 6: Active-alert list panel

**Files:**
- Modify: `config/grafana/dashboards/Ioniq EV/ioniq-overview.json` (append to `panels`)

**Interfaces:**
- Consumes: Task 5's panels array.
- Produces: panel id 13 — the final panel. The dashboard is complete after this task.

Grafana 9.5.21 swaps the whole plugin at registration
(`config.unifiedAlertingEnabled ? unifiedAlertList : alertList`). Unified alerting is **on by default** when
neither `[alerting].enabled` nor `[unified_alerting].enabled` is set — and `config/grafana/config.ini` sets
neither, it only sets `[paths] provisioning`. Our rules are YAML-provisioned unified rules, so the
**`UnifiedAlertListOptions`** schema applies. No option "turns unified on"; the swap happens at plugin level.

Folder filtering is **by title**: the filter reads only `.title`
(`filteredRules.filter(rule => rule.namespaceName === options.folder.title)`); `id`/`uid` are never consulted.
That makes `{"title": "Ioniq EV"}` stable across environments and independent of the provisioned folder's DB
id — exactly what hand-authored JSON needs. The legacy schema's numeric `folderId` is dead code here.

- [ ] **Step 1: Append panel 13**

No `datasource` and no `targets` — the panel sets `skipDataQuery: true`. `sortOrder: 3` is the numeric enum
value for Importance (`AlphaAsc=1, AlphaDesc=2, Importance=3, TimeAsc=4, TimeDesc=5`). `stateFilter` keys are
exactly `firing, pending, noData, normal, error` — the legacy `inactive` key must not appear.

```json
    {
      "description": "Alerts currently firing, pending or erroring from the \"Ioniq EV\" alert folder (the Phase-2/3 battery, 12 V, cell-health, DTC and TPMS rules). Filtering is by folder title, which stays stable across environments regardless of the provisioned folder's database id. An empty list is the healthy state — it means nothing is firing.",
      "gridPos": {
        "h": 6,
        "w": 24,
        "x": 0,
        "y": 9
      },
      "id": 13,
      "options": {
        "alertInstanceLabelFilter": "",
        "alertName": "",
        "dashboardAlerts": false,
        "folder": {
          "title": "Ioniq EV"
        },
        "groupBy": [],
        "groupMode": "default",
        "maxItems": 20,
        "sortOrder": 3,
        "stateFilter": {
          "error": true,
          "firing": true,
          "noData": false,
          "normal": false,
          "pending": true
        },
        "viewMode": "list"
      },
      "title": "Active Alerts",
      "type": "alertlist"
    }
```

- [ ] **Step 2: Validate JSON and confirm all 13 panels are present with unique ids**

```bash
python3 - <<'EOF'
import json
d = json.load(open('config/grafana/dashboards/Ioniq EV/ioniq-overview.json'))
ids = [p['id'] for p in d['panels']]
print('panel count:', len(d['panels']))
print('ids:', ids)
print('unique ids:', len(ids) == len(set(ids)))
print('types:', sorted({p['type'] for p in d['panels']}))
al = [p for p in d['panels'] if p['type'] == 'alertlist'][0]
print('alertlist has datasource:', 'datasource' in al, '(must be False)')
print('alertlist has targets:', 'targets' in al, '(must be False)')
print('alertlist folder:', al['options']['folder'])
EOF
```
Expected: panel count 13; ids 1–13; unique True; alertlist has **no** datasource and **no** targets;
folder `{'title': 'Ioniq EV'}`.

- [ ] **Step 3: Verify no forbidden 9.5.21 keys leaked in**

```bash
grep -nE "minVizWidth|minVizHeight|\"sizing\"|percentunit|folderId|\"inactive\"" \
  "config/grafana/dashboards/Ioniq EV/ioniq-overview.json" && echo "FORBIDDEN KEY FOUND" || echo "CLEAN"
```
Expected: `CLEAN`. Those keys either do not exist in 9.5.21 or belong to the legacy alertlist schema.

- [ ] **Step 4: Restart and verify the alertlist resolves the folder**

The check must resolve the **folder UID for the title "Ioniq EV"** and filter rules on it. A naive filter like
`[r for r in rules if r.get('folderUID') and r.get('ruleGroup')]` is worthless — both keys are set on *every*
provisioned rule, so it would happily list heat-pump and boiler rules and pass even if no Ioniq rule existed.

```bash
docker restart ioniq-val-grafana && sleep 20
python3 - <<'EOF'
import json, urllib.request, base64
def api(path):
    r = urllib.request.Request("http://127.0.0.1:13000" + path)
    r.add_header("Authorization", "Basic " + base64.b64encode(b"admin:admin").decode())
    return json.load(urllib.request.urlopen(r))

folders = api("/api/folders")
match = [f for f in folders if f["title"] == "Ioniq EV"]
print("folders:", [f["title"] for f in folders])
assert match, 'FAIL: no folder titled exactly "Ioniq EV"'
uid = match[0]["uid"]
print('folder "Ioniq EV" uid:', uid)

rules = api("/api/v1/provisioning/alert-rules")
mine = [r["title"] for r in rules if r.get("folderUID") == uid]
print("rule count in Ioniq EV:", len(mine))
for t in mine:
    print("  -", t)
assert mine, "FAIL: no alert rules in the Ioniq EV folder"
EOF
```
Expected: a folder titled exactly `Ioniq EV`, and a non-empty list of the Phase-2/3 ioniq rules provisioned
into **that** folder UID. The panel filters by folder *title*, so a title match is what makes it resolve —
this check proves the title the panel hardcodes is the title the rules actually live under.

- [ ] **Step 5: Commit**

```bash
git add "config/grafana/dashboards/Ioniq EV/ioniq-overview.json"
git commit -m "$(cat <<'EOF'
feat(ioniq): overview active-alert list

Surfaces the Phase-2/3 Ioniq alert rules on the Overview, filtered to the
"Ioniq EV" alert folder.

Authored against the Grafana 9.5.21 source rather than copied: the repo has
no alertlist precedent, and 9.5.21 swaps the plugin at registration
(unifiedAlertList when unified alerting is on, which it is by default since
config.ini sets neither alerting flag). That means the unified options
schema applies — hence the numeric sortOrder enum and the firing/pending/
noData/normal/error stateFilter keys rather than the legacy shape.

Filtering is by folder title, not id: the filter compares namespaceName to
options.folder.title and never consults id/uid, so a title is stable across
environments and needs no knowledge of the provisioned folder's database id.
The panel sets skipDataQuery, so it deliberately carries no datasource and
no targets.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
EOF
)"
```

---

## Task 7: Whole-dashboard live validation + evidence capture

No code changes. This task produces the evidence the PR verdict rests on.

**Files:** none modified.

- [ ] **Step 1: Full clean restart and provisioning-log evidence**

```bash
docker rm -f ioniq-val-grafana >/dev/null 2>&1
REPO="$(git rev-parse --show-toplevel)" RU="$RU" RP="$RP" "$SCRATCH/run-grafana.sh"
# what the dashboard provisioner ACTUALLY logs in 9.5.21 (capture verbatim for the verdict)
docker logs ioniq-val-grafana 2>&1 | grep -i "provisioning" | head -20
docker logs ioniq-val-grafana 2>&1 | grep -iE "logger=provisioning.dashboard" | grep -iE "error|failed" || echo "NO DASHBOARD PROVISIONING ERRORS"
docker logs ioniq-val-grafana 2>&1 | grep -iE "error|failed|invalid" | grep -i ioniq || echo "NO IONIQ ERRORS"
```
Expected: `NO DASHBOARD PROVISIONING ERRORS` and `NO IONIQ ERRORS`. Capture the real provisioning lines
verbatim — the verdict must report **what 9.5.21 actually logs**, and state plainly that the brief's
`finished to provision dashboards` line does not exist in this version.

- [ ] **Step 2: Folder title evidence**

```bash
curl -s -u admin:admin "http://127.0.0.1:13000/api/search?query=Ioniq%20EV" | python3 -m json.tool
```
Expected: `"folderTitle": "Ioniq EV"` — quote it verbatim in the verdict.

- [ ] **Step 3: Per-panel render evidence via the browser**

Open `http://127.0.0.1:13000/d/ioniq-overview` and screenshot the whole dashboard. Every one of the 13 panels
must show real data. Specifically confirm:
- SoC gauge: two gauges, ~52 % and ~54 %, green, **labelled "SoC (BMS)" and "SoC (dash)"** — not
  `ioniq.soc` / `ioniq.soc_display`.
- Pack Voltage ≈ 351.7 V, Pack Current ≈ 3.1 A, Pack Power ≈ 1.09 kW.
- 12 V ≈ 13.5 V, green background.
- DTC Status: green "No DTCs".
- **Last Seen: a relative time (e.g. "26 minutes ago"), NOT "No data" and NOT a red epoch number.**
- Odometer: **`174650 km`** — **not** `175 Mm` (SI-rescaled, means the unit regressed to `lengthkm`) and
  **not** ~146 (means the `"group"='odometer'` scope was lost and it is rendering `range_est`).
- Four tires ≈ 37 / 35.4 / 35.8 / 36.2 psi, all green.
- Active Alerts: renders the list (empty = healthy, but it must not error).

Any panel showing "No data" must be **explained with evidence**, never hand-waved.

- [ ] **Step 4: Nav dropdown evidence**

The tag-based nav is the template's headline deviation, so prove it works rather than asserting it. With only
one `ioniq`-tagged dashboard existing today, the dropdown should list exactly this dashboard — proving the
mechanism resolves. PR2's four siblings will then appear automatically with no edit to this file.

```bash
curl -s -u admin:admin "http://127.0.0.1:13000/api/search?tag=ioniq" | python3 -m json.tool
```
Expected: exactly one entry, `ioniq-overview`, in folder `Ioniq EV`.

- [ ] **Step 5: Tear down the harness — leave no stray processes**

The teardown pattern must match the **dual-bind** argv from Task 1 (`-L 127.0.0.1:18086:... -L 172.17.0.1:18086:...`);
a pattern like `ssh -f -N -L 18086` would silently match nothing and leak the tunnel.

```bash
docker rm -f ioniq-val-grafana
pkill -f 'ssh -f -N -L .*18086' || true
sleep 1
pgrep -af '18086' || echo "no tunnel processes remain"
curl -s -o /dev/null -w "%{http_code}\n" --max-time 3 http://127.0.0.1:18086/ping || echo "tunnel closed"
docker ps --filter name=ioniq-val-grafana --format '{{.Names}}' # expect empty
```
Expected: no tunnel processes remain, the ping fails/`000` (tunnel closed), and the container list is empty.

- [ ] **Step 6: No commit**

Evidence only.

---

## Task 8: Commit the build brief and open the PR

**Files:**
- Create: `docs/superpowers/plans/2026-07-15-ioniq-phase4-dashboards-build-brief.md`
- Create: `docs/superpowers/plans/2026-07-15-ioniq-overview-dashboard.md` (this plan)

The build brief is currently **untracked** in the main checkout and would otherwise be lost. PR2 depends on it.

- [ ] **Step 1: Copy the brief into the worktree**

```bash
cp /home/groupsky/src/homy/docs/superpowers/plans/2026-07-15-ioniq-phase4-dashboards-build-brief.md \
   docs/superpowers/plans/
```

- [ ] **Step 2: Commit the docs — selective staging only**

The phase-4 **spec** is deliberately NOT staged: PR0 (#1398) already carries it to master, and duplicating
those doc commits here would conflict under squash-merge.

```bash
git add docs/superpowers/plans/2026-07-15-ioniq-phase4-dashboards-build-brief.md \
        docs/superpowers/plans/2026-07-15-ioniq-overview-dashboard.md
git status --short   # confirm ONLY these two files are staged
git commit -m "$(cat <<'EOF'
docs(ioniq): phase-4 dashboards build brief + overview build plan

The build brief is the verified ground truth behind this dashboard family —
Grafana version, canonical JSON shape, the prod field table, the km-overload
and count()-liveness traps, and verbatim gauge/alertlist JSON for 9.5.21.
It was untracked and would have been lost; PR2 clones the template from it.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
EOF
)"
```

- [ ] **Step 3: Verify the branch contains exactly the intended files**

```bash
git diff --name-only origin/master...HEAD
```
Expected exactly three paths:
```
config/grafana/dashboards/Ioniq EV/ioniq-overview.json
docs/superpowers/plans/2026-07-15-ioniq-overview-dashboard.md
docs/superpowers/plans/2026-07-15-ioniq-phase4-dashboards-build-brief.md
```
Anything else (especially `docker/automations/**`, or the phase-4 spec) is a scope violation — remove it.

- [ ] **Step 4: Write the PR body to a file**

Shell quoting mangles JSON and InfluxQL, so the body goes in a file and is passed with `--body-file`.
Fill the evidence in from Task 7's captured output — **do not write claims you did not observe**.

```bash
cat > "$SCRATCH/pr-body.md" <<'EOF'
## What

Adds the **Ioniq EV** Grafana dashboard folder, the `ioniq-overview` dashboard, and the shared template
that the remaining four Phase-4 dashboards (PR2) clone.

Spec: `docs/superpowers/specs/2026-07-15-ioniq-monitoring-phase4-dashboards-design.md` §2, §3.1
(carried to master by #1398). Ground truth: the build brief committed here.

## Panels (spec §3.1)

SoC + SoC-display gauge · pack V/A/kW · 12 V (banded) · DTC status · last-seen · odometer ·
four tire pressures · active-alert list filtered to the "Ioniq EV" alert folder.

## Template decisions PR2 inherits

- **Tag-based nav** (`"type": "dashboards"` filtered to tag `ioniq`) rather than the sunseeker family's
  hardcoded `/d/<uid>` links: siblings auto-populate the nav as they land, so no dead links and no
  cross-PR file edits.
- `refresh: 1m` and Overview `now-24h` per the spec (the car sleeps; 30s buys nothing).
- Series are named with the target **`alias`** field, never `byName` overrides — see below.

## Validation (local Grafana 9.5.21 + read-only SSH tunnel to prod InfluxDB)

Real prod data, read-only, never provisioned onto the prod Grafana. Evidence in the PR thread /
orchestrator verdict: rendered folder title, per-panel values, nav dropdown.

## Notable correctness traps handled

- **`km` is overloaded**: `odometer`.km = 174650 vs `range_est`.km = ~145.6, same field, same measurement.
  Verified against prod: an unscoped `last("km")` returns **145.6** — the range estimate, not the odometer.
  The panel is scoped `"group"='odometer'`.
- **Liveness never uses `count()`**: an empty window returns *no row* while the car sleeps, so a
  count()-based panel goes blank exactly when liveness matters. Last-seen reduces the `Time` field with
  `unit: dateTimeFromNow`.
- **InfluxQL series naming**: the 9.5.21 frontend parser names series `<measurement>.<column>` unless the
  column is literally `value`, so `byName` overrides on an aliased column silently never match. Display
  names use the target `alias` field instead. (`sunseeker-overview.json`'s `byName: "battery"` override is
  dead code for this reason — deliberately not copied.)
- Dotted TPMS fields are quoted as whole identifiers (`"fl.psi"`); `"group"` is quoted (reserved word).
- Threshold bands mirror the shipped alert rules exactly (12 V 11.8/12.2; tires 26/30/42; DTC >0) so the
  dashboard and the alerts can never disagree.

## Out of scope

The other four dashboards (PR2), any bot, any alert rule, and the ioniq-tpms fix (#1398). The Overview's
tire stats read the **parsed** `tpms` fields and therefore do not depend on #1398.
EOF
echo "--- body written ---"; wc -l "$SCRATCH/pr-body.md"
```

- [ ] **Step 5: Push and open the PR**

```bash
git push -u origin feat/ioniq-overview-dashboard
gh pr create --base master \
  --title 'feat(ioniq): EV Overview dashboard + "Ioniq EV" folder + shared template' \
  --body-file "$SCRATCH/pr-body.md"
```

- [ ] **Step 6: Verify the PR opened against the right base**

```bash
gh pr view --json number,baseRefName,url,files -q '{number:.number,base:.baseRefName,url:.url,files:[.files[].path]}'
```
Expected: `base` is `master`, and `files` lists exactly the three paths from Step 3.

---

## Review gates

Independent **fresh** subagents, model-matched. The author never reviews its own work.

| Gate | When | Model | Scope |
|---|---|---|---|
| Plan review | before Task 1 | opus | this plan vs the spec §3.1/§6/§8 and the build brief |
| Template gate | after Task 2 | opus | the canonical skeleton + nav block PR2 will clone — the point of this PR |
| Mechanical check | after Task 6 | haiku | JSON validity, key order, panel-id uniqueness, forbidden-key scan |
| Whole-branch review | after Task 7 | opus | the complete dashboard + evidence, against spec + brief |

## Self-review notes

**Spec coverage (§3.1):** SoC + soc_display gauge → Task 3 panel 1. Pack V/A/kW → Task 3 panels 2–4. 12 V
color-banded → Task 3 panel 5. DTC status → Task 4 panel 6. Last-seen (last(soc)+time, not count) → Task 4
panel 7. Odometer → Task 4 panel 8. Four tire stats via last() → Task 5 panels 9–12. Alertlist filtered to the
"Ioniq EV" folder → Task 6 panel 13. §2 template (datasource, tag nav, tags, styling, time, refresh) → Task 2.
§2.2 folder → Task 2 step 3. §6 validation → Tasks 1 and 7. §8 acceptance → Tasks 7 and 8.

**Out of scope, deliberately:** the other four dashboards (PR2), any bot, any alert rule, the ioniq-tpms fix
(PR0, #1398, in flight — `docker/automations/**` is untouched), and the phase-4 spec doc (PR0 carries it).
