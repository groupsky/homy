# Ioniq OBD Logging — Design

**Date:** 2026-07-14
**Status:** Approved for planning
**Author:** Geno Roupsky (with Claude)

## Goal

An OBD logger for a Hyundai Ioniq (28 kWh) will publish vehicle telemetry to the
MQTT broker under the `ioniq/#` topic tree. We want to capture all of it so it can
be analyzed later, serving three needs the user explicitly selected:

1. **Raw capture / replay** — keep every message verbatim so still-ambiguous OBD
   frames can be reverse-engineered from real fleet data.
2. **Grafana time-series** — plot decoded metrics (SoC, HV pack V/A, speed, temps,
   TPMS, …) alongside the rest of the home-automation data.
3. **Ad-hoc queries** — query historical decoded values later (trips, charging
   sessions).

## Logger publish contract (external, owned by the logger project)

The logger publishes JSON on every channel. `ioniq` is a configurable prefix.

- `ioniq/parsed/<group>` — decoded telemetry, change-detected on decoded fields.
- `ioniq/raw/<group>` — reassembled ISO-TP hex for still-ambiguous groups,
  change-detected on the hex string (deduped, low volume).
- `ioniq/status` — Last-Will/online status.

Every payload carries `_type`, `group`, `state`, `ts` (epoch ms):

```jsonc
// ioniq/parsed/bms/2101
{ "_type":"ioniq", "group":"bms/2101", "state":"active", "ts":1720000000000,
  "soc":36.5, "hv_v":346.9, "hv_a":-2.3, "12v":13.6, "relays":{ "main":true } }

// ioniq/raw/igmp_bc03
{ "_type":"ioniq", "group":"igmp_bc03", "state":"parked", "ts":1720000000000,
  "raw":"62BC03FDEE3C7300602C00", "hdr":"770", "req":"22BC03" }

// ioniq/status
{ "_type":"ioniq", "group":"status", "online":true, "ts":1720000000000 }
```

The clean `parsed/` vs `raw/` split lets the two consumers subscribe to exactly the
data each needs, without payload inspection or filtering.

## Architecture

Two independent MQTT subscribers, each reusing an existing Docker image already in
the repo. No Telegraf, no new base image, no Dependabot entry, no secrets shim.

```
                    ┌─ mqtt-mongo-ioniq  ──▶ Mongo    (collection: ioniq, TTL 90d)   [parsed + raw + status, full fidelity]
ioniq/#  ──broker──┤
                    └─ mqtt-influx-ioniq ──▶ InfluxDB (homy, measurement: ioniq)      [parsed only → Grafana / InfluxQL]
```

Rationale for two stores: raw fidelity and time-series charting pull toward
different databases. Mongo keeps the literal `{topic, payload}` (nothing lost, even
shapes we have not seen yet); InfluxDB holds compact numeric fields for Grafana and
InfluxQL. This matches all three stated goals and reuses established repo patterns
(`mqtt-mongo-history`, the `mqtt-influx-*` fleet).

## Component 1 — `mqtt-mongo-ioniq` (raw archive)

**Purpose:** lossless archive of every Ioniq message for replay and
reverse-engineering; also serves flexible ad-hoc queries via Mongo.

**Service:** new block in `docker-compose.yml` reusing the existing
`docker/mqtt-mongo` image (no code duplication).

- `TOPIC=ioniq/#` — captures parsed, raw, and status.
- `COLLECTION=ioniq`
- `MQTT_CLIENT_ID=mqtt-mongo-ioniq`
- Reuses existing broker + Mongo secrets (`MONGODB_URL`,
  `MONGODB_USERNAME_FILE`, `MONGODB_PASSWORD_FILE`).

All three channels are valid JSON, so `mqtt-mongo`'s unguarded `JSON.parse`
(`docker/mqtt-mongo/index.js:87`) is safe here.

**Retention (90-day TTL):** InfluxDB is kept forever (compact); the bulky raw JSON
archive in Mongo is capped at 90 days.

MongoDB TTL indexes expire only on a BSON `Date` field. Today `mqtt-mongo` writes
`_tz = Date.now()` — a plain epoch **number** (`index.js:89`), which a TTL index
cannot use. Required change:

- **Minimal, backward-compatible enhancement to `docker/mqtt-mongo/index.js`:** also
  write `_ts: new Date()` (BSON Date) alongside the existing `_tz`. Harmless to the
  only current consumer (`mqtt-mongo-history`), and unlocks a standard TTL index.
- **TTL index:** create once on `ioniq._ts` with `expireAfterSeconds = 7776000`
  (90 days). Mechanism to be finalized in the plan; preferred option is an
  idempotent one-time index-creation documented in the service CLAUDE.md /
  runbook (Mongo silently ignores re-creation of an identical index), rather than
  adding startup index-management code to the shared `mqtt-mongo` image.

TTL uses ingest time (`_ts`), which is acceptable; the logger's event time remains
available in `payload.ts`.

## Component 2 — `mqtt-influx-ioniq` (time-series)

**Purpose:** decoded telemetry into InfluxDB for Grafana dashboards and InfluxQL.

**Service:** new block in `docker-compose.yml` reusing the existing
`docker/mqtt-influx` image.

- `TOPIC=ioniq/parsed/#` — subscription-level routing: raw and status never reach
  this consumer, so no "Unhandled type" noise and no payload filtering needed.
- `INFLUXDB_DATABASE=homy` (existing database)
- `MQTT_CLIENT_ID=mqtt-influx-ioniq`
- Reuses existing InfluxDB write-user secrets (`influxdb_write_user`,
  `influxdb_write_user_password`).
- No `TAGS` default needed (see "no variant tag" below).

**New converter `converters/ioniq.js`, registered under `_type: "ioniq"`** in
`index.js`'s `converters` map:

- **Measurement:** `ioniq`
- **Tags:** `group` (`data.group`) and `state` (`data.state`). `state`
  (`active`/`parked`/`charging`/…) is low-cardinality and exactly what dashboards
  filter/group by (driving vs charging vs parked).
- **Timestamp:** `data.ts` passed directly to `.timestamp()` (the write API is
  configured with `'ms'` precision; existing converters pass the epoch-ms number
  directly, e.g. `mbsl32di.js:26`).
- **Fields:** every key except `_type`, `group`, `state`, `ts`:
  - number → `floatField` (uniformly, even integers, to avoid InfluxDB
    field-type conflicts when a value is sometimes integral, sometimes not).
  - boolean → `booleanField`.
  - string → `stringField`.
  - nested object (e.g. `relays:{…}`) → flattened recursively into dotted field
    keys (`relays.main`), each leaf typed by the rules above.
  - array → JSON-stringified into a single `stringField`.
- Returns an array with a single `Point`.

**No `variant` tag:** the topic scheme carries no `28kwh` segment; the `ioniq`
prefix identifies the car. A second vehicle later would use a second prefix and a
second pair of service instances.

**Defensive note:** although subscription filtering keeps raw/status out, the
converter should tolerate a payload with no numeric fields (emit a Point with just
tags, or skip) rather than throwing, since all `ioniq/*` payloads share
`_type:"ioniq"`.

## Data flow

```
Logger ──▶ broker ──┬─ ioniq/#         ──▶ mqtt-mongo-ioniq  ──▶ Mongo   ioniq   (90d TTL)
                    └─ ioniq/parsed/#  ──▶ mqtt-influx-ioniq ──▶ InfluxDB homy.ioniq (∞)
                                                                    └─▶ Grafana
```

## Error handling

- `mqtt-influx` already wraps message handling in try/catch and skips malformed
  messages without crashing (`index.js:62-78`). The new converter inherits this.
- `mqtt-mongo` exits on Mongo/MQTT errors and relies on `restart: unless-stopped`;
  the `_ts` change does not alter this behavior.
- Unknown/future decoded field shapes degrade gracefully: unrecognized leaf types
  fall through to `stringField` (or are skipped), never crashing the bridge.

## Testing

Project standard is Jest with minimal mocking (per `docker/CLAUDE.md`).

- **`converters/ioniq.js` unit tests** — `mqtt-influx` has no Jest setup yet, so
  add `jest` as a devDependency, a real `test` script, and a
  `converters/__tests__/ioniq.test.js`. Feed representative parsed frames captured
  from the logger project's `logs/charging.log` / `logs/driving.log` (SoC 36.5,
  speed 54.3, DC 343 V / 3.3 A, DTC "none", TPMS −50, a nested `relays` object) and
  assert the emitted Point's measurement, `group`/`state` tags, `ts` timestamp, and
  each typed/flattened field. This doubles as a decode-regression net independent of
  the car. (Sample frames are copied into the test as fixtures; the log files live
  in the separate logger project, not this repo.)
- **`mqtt-mongo` `_ts` test** — assert an inserted record gains a BSON `Date` `_ts`
  while `_tz` (epoch number) is preserved, matching the existing insert behavior.
- **Manual end-to-end verification** — publish sample parsed/raw/status messages to
  a test broker and confirm: raw+status land in Mongo only, parsed lands in both,
  the TTL index exists on `ioniq._ts`, and the `ioniq` measurement is queryable.

## Documentation & config updates

- **`docs/influxdb-schema.md`** — document the new `ioniq` measurement (tags
  `group`, `state`; representative fields; ingest path).
- **`docker/mqtt-influx/CLAUDE.md`** — add `mqtt-influx-ioniq` to the instances
  list and note the `ioniq` converter.
- **`docker/mqtt-mongo`** — document the `_ts` field and the one-time TTL index
  command.
- **`example.env`** — add any new variables used by the two service blocks
  (client IDs, etc.) with example values.
- **`secrets/`** — no new secrets (reuses existing InfluxDB/Mongo write secrets).

## Out of scope

- Grafana dashboards for the Ioniq data (build once real data shapes are known).
- Decoding still-ambiguous groups (that is the logger project's job; the raw
  archive exists to support it).
- A second vehicle / multi-car generalization.

## Explicitly rejected alternatives

- **Telegraf `mqtt_consumer`** — would need a new `ghcr.io/groupsky/homy/telegraf`
  base image (GHCR-only policy), a Docker-secrets shim (no native `_FILE` support),
  and a Dependabot entry. More moving parts than reusing `mqtt-influx`.
- **Topic-based dispatch in `mqtt-influx`** — modifying the shared bridge core to
  select converters by topic was rejected in favor of the documented `_type`
  convention, which the logger already emits.
- **Mongo-only or InfluxDB-only** — each satisfies only a subset of the three
  stated goals.
```
