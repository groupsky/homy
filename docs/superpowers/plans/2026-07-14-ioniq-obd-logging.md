# Ioniq OBD Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Capture a Hyundai Ioniq OBD logger's MQTT telemetry (`ioniq/#`) into a 90-day Mongo raw archive and an InfluxDB time-series measurement, by adding two docker-compose service blocks that reuse existing images plus one new InfluxDB converter.

**Architecture:** Two independent MQTT subscribers, each reusing an image already in the repo. `mqtt-mongo-ioniq` archives all of `ioniq/#` verbatim into Mongo collection `ioniq` (capped by a 90-day TTL index). `mqtt-influx-ioniq` decodes `ioniq/parsed/#` into InfluxDB measurement `ioniq` via a new `converters/ioniq.js` registered under `_type:"ioniq"`. To unlock the TTL index, `mqtt-mongo` also writes a BSON `Date` `_ts` alongside its existing epoch-number `_tz`.

**Tech Stack:** Node.js 18/24 (alpine), `@influxdata/influxdb-client` v1.35, `mongodb` v7, `mqtt` v5, Jest v30, Docker Compose.

**Source spec:** `docs/superpowers/specs/2026-07-14-ioniq-obd-logging-design.md`

## Global Constraints

- Reuse existing images ONLY — no new Dockerfile, no Telegraf, no new base image, no Dependabot entry.
- Base images: GHCR-only (`ghcr.io/groupsky/homy/*`); the two new blocks reuse `ghcr.io/groupsky/homy/mqtt-mongo` and `ghcr.io/groupsky/homy/mqtt-influx`.
- Selective staging only — stage exactly the files named in each task's commit; never `git add .` / `git add -A`.
- Jest is added as a **devDependency** only; the Dockerfiles install with `npm ci --omit=dev`, so the runtime images stay unchanged. Adding jest REQUIRES running `npm install` to refresh `package-lock.json` (in-sync lockfile is mandatory for `npm ci` in CI).
- No new env vars are introduced (client IDs / topics / collection are hard-coded literals, matching every existing `mqtt-influx-*` / `mqtt-mongo-history` block; `INFLUXDB_DATABASE=homy` and `MONGO_DATABASE=power` already exist in `example.env`). Therefore `example.env` needs no change — confirm this, do not invent variables.
- New InfluxDB measurement → update `docs/influxdb-schema.md`.
- JavaScript for converter and tests; minimal mocking (test real serialization / real record-building, not mocks).

## File Structure

| File | Responsibility |
|------|----------------|
| `docker/mqtt-influx/converters/ioniq.js` | **Create.** Convert an `ioniq` parsed payload → single InfluxDB `Point` (measurement `ioniq`, tags `group`/`state`, ts passthrough, recursively-flattened typed fields). |
| `docker/mqtt-influx/converters/__tests__/ioniq.test.js` | **Create.** Jest unit tests over sample parsed frames from the spec. |
| `docker/mqtt-influx/index.js` | **Modify.** Register `ioniq: require('./converters/ioniq')` in the `converters` map. |
| `docker/mqtt-influx/package.json` | **Modify.** Add `jest` devDependency + `"test": "jest"`. |
| `docker/mqtt-influx/jest.config.js` | **Create.** Minimal node-environment Jest config. |
| `docker/mqtt-influx/package-lock.json` | **Modify (generated).** Refreshed by `npm install`. |
| `docker/mqtt-mongo/record.js` | **Create.** Pure `buildRecord(topic, message, now)` that adds BSON-`Date` `_ts` + epoch `_tz`; extracted so it is testable without MQTT side effects. |
| `docker/mqtt-mongo/index.js` | **Modify.** Use `buildRecord` in the message handler. |
| `docker/mqtt-mongo/__tests__/record.test.js` | **Create.** Jest unit tests for `buildRecord`. |
| `docker/mqtt-mongo/package.json` | **Modify.** Add `jest` devDependency + `"test": "jest"`. |
| `docker/mqtt-mongo/jest.config.js` | **Create.** Minimal node-environment Jest config. |
| `docker/mqtt-mongo/package-lock.json` | **Modify (generated).** Refreshed by `npm install`. |
| `docker-compose.yml` | **Modify.** Add `mqtt-mongo-ioniq` (after `mqtt-mongo-history`) and `mqtt-influx-ioniq` (after `mqtt-influx-dry-switches`). |
| `docs/influxdb-schema.md` | **Modify.** Document the `ioniq` measurement. |
| `docker/mqtt-influx/CLAUDE.md` | **Modify.** Add `mqtt-influx-ioniq` instance + `ioniq` converter. |
| `docker/mqtt-mongo/CLAUDE.md` | **Create.** Document the service, the `_ts`/`_tz` fields, and the one-time TTL index runbook command. |

---

## Task 1: `ioniq` InfluxDB converter (+ mqtt-influx Jest setup)

**Files:**
- Create: `docker/mqtt-influx/jest.config.js`
- Create: `docker/mqtt-influx/converters/ioniq.js`
- Create: `docker/mqtt-influx/converters/__tests__/ioniq.test.js`
- Modify: `docker/mqtt-influx/package.json`
- Modify: `docker/mqtt-influx/index.js:22-30`
- Modify (generated): `docker/mqtt-influx/package-lock.json`

**Interfaces:**
- Produces: `module.exports = function ioniq(data) => Point[]` — a CommonJS module exporting a single function that takes the parsed MQTT payload object and returns an array with exactly one `@influxdata/influxdb-client` `Point`.
- Consumes: nothing from other tasks.

**Converter contract (from spec):**
- Measurement `ioniq`. Tags `group` (`data.group`), `state` (`data.state`). Timestamp `data.ts` passed directly (write API precision is `'ms'`; a numeric timestamp passes through verbatim).
- Fields: every key except `_type`, `group`, `state`, `ts`. number→`floatField` (uniformly, even integers), boolean→`booleanField`, string→`stringField`, nested object→recursively flattened into dotted keys, array→JSON-stringified `stringField`. `null`/`undefined` leaves are skipped.
- Tolerate a payload with no numeric fields without throwing (still emits the Point with tags).

- [ ] **Step 1: Add Jest to package.json**

Replace the `scripts` and add `devDependencies` in `docker/mqtt-influx/package.json`:

```json
{
  "name": "homy-modbus-serial-docker",
  "version": "1.0.0",
  "description": "Serial modbus reader",
  "author": "Geno Roupsky",
  "license": "ISC",
  "main": "index.js",
  "scripts": {
    "start": "index.js",
    "test": "jest"
  },
  "dependencies": {
    "@influxdata/influxdb-client": "^1.35.0",
    "mqtt": "^5.15.0"
  },
  "devDependencies": {
    "jest": "^30.2.0"
  }
}
```

- [ ] **Step 2: Refresh the lockfile & install jest locally**

Run: `cd docker/mqtt-influx && npm install`
Expected: exits 0; `package-lock.json` now references `jest`; `node_modules/.bin/jest` exists (node_modules is gitignored).

- [ ] **Step 3: Create the Jest config**

Create `docker/mqtt-influx/jest.config.js`:

```javascript
/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    clearMocks: true,
    restoreMocks: true,
}
```

- [ ] **Step 4: Write the failing test**

Create `docker/mqtt-influx/converters/__tests__/ioniq.test.js`. Assertions run against `point.toLineProtocol()` (verified: booleans render `T`/`F`, float-valued integers render without an `i` suffix, a numeric timestamp passes through verbatim, field keys are emitted alphabetically). Frames are copied from the spec as fixtures.

```javascript
const ioniq = require('../ioniq')

describe('ioniq converter', () => {
    // parsed BMS frame from the spec, with a nested relays object
    const bms = {
        _type: 'ioniq', group: 'bms/2101', state: 'active', ts: 1720000000000,
        soc: 36.5, hv_v: 346.9, hv_a: -2.3, '12v': 13.6, relays: { main: true },
    }

    it('returns exactly one Point', () => {
        const points = ioniq(bms)
        expect(Array.isArray(points)).toBe(true)
        expect(points).toHaveLength(1)
    })

    it('uses measurement ioniq with group and state tags', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp).toMatch(/^ioniq,group=bms\/2101,state=active /)
    })

    it('passes the epoch-ms ts straight through as the timestamp', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp.endsWith(' 1720000000000')).toBe(true)
    })

    it('types numbers as floats (no integer i-suffix) and skips reserved keys', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp).toContain('soc=36.5')
        expect(lp).toContain('hv_v=346.9')
        expect(lp).toContain('hv_a=-2.3')
        expect(lp).toContain('12v=13.6')
        expect(lp).not.toContain('_type')
        expect(lp).not.toContain('group=bms/2101i') // never an int field
    })

    it('flattens nested objects into dotted boolean field keys', () => {
        const lp = ioniq(bms)[0].toLineProtocol()
        expect(lp).toContain('relays.main=T')
    })

    it('types strings as quoted string fields (DTC "none")', () => {
        const frame = { _type: 'ioniq', group: 'obd/dtc', state: 'parked', ts: 1720000000001, dtc: 'none' }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('dtc="none"')
    })

    it('handles negative sensor values (TPMS -50) and driving speed', () => {
        const frame = { _type: 'ioniq', group: 'tpms', state: 'active', ts: 1720000000002, temp: -50, speed: 54.3 }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('temp=-50')
        expect(lp).toContain('speed=54.3')
    })

    it('JSON-stringifies arrays into a single string field', () => {
        const frame = { _type: 'ioniq', group: 'cells', state: 'charging', ts: 1720000000003, dc: 343, cells: [1, 2, 3] }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('dc=343')
        expect(lp).toContain('cells="[1,2,3]"')
    })

    it('skips null/undefined leaves', () => {
        const frame = { _type: 'ioniq', group: 'x', state: 'parked', ts: 1720000000004, a: null, b: undefined, c: 1 }
        const lp = ioniq(frame)[0].toLineProtocol()
        expect(lp).toContain('c=1')
        expect(lp).not.toContain('a=')
        expect(lp).not.toContain('b=')
    })

    it('does not throw on a payload with no numeric/decodable fields', () => {
        const frame = { _type: 'ioniq', group: 'status', state: 'parked', ts: 1720000000005 }
        expect(() => ioniq(frame)).not.toThrow()
        expect(ioniq(frame)).toHaveLength(1)
    })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd docker/mqtt-influx && npx jest converters/__tests__/ioniq.test.js`
Expected: FAIL — `Cannot find module '../ioniq'`.

- [ ] **Step 6: Implement the converter**

Create `docker/mqtt-influx/converters/ioniq.js`:

```javascript
const {Point} = require('@influxdata/influxdb-client')

// Payload keys that map to the measurement's identity, not to fields.
const RESERVED = new Set(['_type', 'group', 'state', 'ts'])

/**
 * Adds one payload leaf to the point, choosing the InfluxDB field type by the
 * JS runtime type. Numbers are stored uniformly as floats (even integral ones)
 * so a field that is sometimes 36 and sometimes 36.5 never triggers an
 * InfluxDB int/float type conflict. Nested objects are flattened recursively
 * into dotted keys (relays.main); arrays are JSON-stringified into one string
 * field. null/undefined leaves are skipped. Unknown types fall back to a
 * string so a future payload shape can never crash the bridge.
 */
function addField(point, key, value) {
    if (value === null || value === undefined) {
        return
    }
    switch (typeof value) {
        case 'number':
            if (Number.isFinite(value)) {
                point.floatField(key, value)
            }
            break
        case 'boolean':
            point.booleanField(key, value)
            break
        case 'string':
            point.stringField(key, value)
            break
        case 'object':
            if (Array.isArray(value)) {
                point.stringField(key, JSON.stringify(value))
            } else {
                for (const [childKey, childValue] of Object.entries(value)) {
                    addField(point, `${key}.${childKey}`, childValue)
                }
            }
            break
        default:
            point.stringField(key, String(value))
    }
}

/**
 * Converts an `ioniq` parsed telemetry payload into a single InfluxDB point.
 * Tags: group, state (low-cardinality; what dashboards filter/group by).
 * Timestamp: data.ts (epoch ms) passed straight to the ms-precision write API.
 */
module.exports = function ioniq(data) {
    const point = new Point('ioniq')

    if (data.group !== undefined && data.group !== null) {
        point.tag('group', String(data.group))
    }
    if (data.state !== undefined && data.state !== null) {
        point.tag('state', String(data.state))
    }
    if (data.ts !== undefined && data.ts !== null) {
        point.timestamp(data.ts)
    }

    for (const [key, value] of Object.entries(data)) {
        if (RESERVED.has(key)) {
            continue
        }
        addField(point, key, value)
    }

    return [point]
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd docker/mqtt-influx && npx jest converters/__tests__/ioniq.test.js`
Expected: PASS — all assertions green.

- [ ] **Step 8: Register the converter in index.js**

In `docker/mqtt-influx/index.js`, add the `ioniq` entry to the `converters` map (keep the object alphabetical-ish, matching the existing style):

```javascript
const converters = {
    'aspar-mod-16ro': require('./converters/aspar-mod-16ro'),
    dds024mr: require('./converters/dds024mr'),
    dds519mr: require('./converters/dds519mr'),
    ex9em: require('./converters/ex9em'),
    ioniq: require('./converters/ioniq'),
    mbsl32di: require('./converters/mbsl32di'),
    'or-we-514': require('./converters/or-we-514'),
    sdm630: require('./converters/sdm630'),
}
```

- [ ] **Step 9: Verify index.js still parses**

Run: `cd docker/mqtt-influx && node --check index.js`
Expected: exits 0, no output.

- [ ] **Step 10: Run the full mqtt-influx test suite**

Run: `cd docker/mqtt-influx && npm test`
Expected: PASS — the ioniq suite runs and is green.

- [ ] **Step 11: Commit**

```bash
git add docker/mqtt-influx/package.json docker/mqtt-influx/package-lock.json \
        docker/mqtt-influx/jest.config.js \
        docker/mqtt-influx/converters/ioniq.js \
        docker/mqtt-influx/converters/__tests__/ioniq.test.js \
        docker/mqtt-influx/index.js
git commit -m "feat(mqtt-influx): add ioniq converter with jest setup"
```

---

## Task 2: mqtt-mongo BSON-`Date` `_ts` for TTL

**Files:**
- Create: `docker/mqtt-mongo/jest.config.js`
- Create: `docker/mqtt-mongo/record.js`
- Create: `docker/mqtt-mongo/__tests__/record.test.js`
- Modify: `docker/mqtt-mongo/index.js:86-101`
- Modify: `docker/mqtt-mongo/package.json`
- Modify (generated): `docker/mqtt-mongo/package-lock.json`

**Interfaces:**
- Produces: `module.exports = { buildRecord }` where `buildRecord(topic: string, message: string|Buffer, now: Date = new Date()) => { topic, payload }`. It JSON-parses `message`, then sets `payload._tz` (epoch **number**) and `payload._ts` (**BSON Date**) from the same `now` only if absent (idempotent / backward-compatible).
- Consumes: nothing from other tasks.

**Why extract `record.js`:** `index.js` connects to MQTT/Mongo on `require`, so it cannot be imported in a unit test. Pulling the record-building into a pure module makes it testable with deterministic time and no mocks.

- [ ] **Step 1: Add Jest to package.json**

Update `docker/mqtt-mongo/package.json`:

```json
{
  "name": "homy-mqtt-mongo-docker",
  "version": "1.0.0",
  "description": "Mqtt to mongo writer",
  "author": "Geno Roupsky",
  "license": "ISC",
  "main": "index.js",
  "scripts": {
    "start": "index.js",
    "test": "jest"
  },
  "dependencies": {
    "mongodb": "^7.1.0",
    "mqtt": "^5.15.0"
  },
  "devDependencies": {
    "jest": "^30.2.0"
  }
}
```

- [ ] **Step 2: Refresh the lockfile & install jest locally**

Run: `cd docker/mqtt-mongo && npm install`
Expected: exits 0; `package-lock.json` references `jest`.

- [ ] **Step 3: Create the Jest config**

Create `docker/mqtt-mongo/jest.config.js`:

```javascript
/** @type {import('jest').Config} */
module.exports = {
    testEnvironment: 'node',
    clearMocks: true,
    restoreMocks: true,
}
```

- [ ] **Step 4: Write the failing test**

Create `docker/mqtt-mongo/__tests__/record.test.js`:

```javascript
const { buildRecord } = require('../record')

describe('buildRecord', () => {
    const now = new Date('2026-07-14T00:00:00.000Z')

    it('adds a BSON Date _ts and a numeric epoch _tz from the same instant', () => {
        const { payload } = buildRecord('ioniq/parsed/bms', '{"_type":"ioniq","soc":36.5}', now)
        expect(payload._ts).toBeInstanceOf(Date)
        expect(payload._ts.getTime()).toBe(now.getTime())
        expect(typeof payload._tz).toBe('number')
        expect(payload._tz).toBe(now.getTime())
    })

    it('preserves the original topic and payload fields', () => {
        const record = buildRecord('ioniq/raw/igmp_bc03', '{"_type":"ioniq","raw":"62BC03"}', now)
        expect(record.topic).toBe('ioniq/raw/igmp_bc03')
        expect(record.payload._type).toBe('ioniq')
        expect(record.payload.raw).toBe('62BC03')
    })

    it('does not overwrite an existing _tz', () => {
        const { payload } = buildRecord('t', '{"_tz":111}', now)
        expect(payload._tz).toBe(111)
    })

    it('does not overwrite an existing _ts', () => {
        const preset = new Date('2020-01-01T00:00:00.000Z')
        const { payload } = buildRecord('t', JSON.stringify({ _ts: preset.toISOString() }), now)
        // an already-present _ts (whatever its form) is left untouched
        expect(payload._ts).toBe(preset.toISOString())
    })

    it('accepts a Buffer message like mqtt delivers', () => {
        const { payload } = buildRecord('t', Buffer.from('{"a":1}'), now)
        expect(payload.a).toBe(1)
        expect(payload._ts).toBeInstanceOf(Date)
    })
})
```

- [ ] **Step 5: Run the test to verify it fails**

Run: `cd docker/mqtt-mongo && npx jest`
Expected: FAIL — `Cannot find module '../record'`.

- [ ] **Step 6: Implement `record.js`**

Create `docker/mqtt-mongo/record.js`:

```javascript
/**
 * Builds the Mongo record for one MQTT message.
 *
 * `_tz` (epoch-ms number) is the historical ingest timestamp, kept for the
 * existing mqtt-mongo-history consumer. `_ts` is the same instant as a BSON
 * `Date`, which is the only field type a MongoDB TTL index can expire on.
 * Both are only set when absent, so re-processing or a producer that already
 * stamped them is preserved. `now` is injectable for deterministic tests.
 */
function buildRecord(topic, message, now = new Date()) {
    const payload = JSON.parse(message)
    if (!payload._tz) {
        payload._tz = now.getTime()
    }
    if (!payload._ts) {
        payload._ts = now
    }
    return { topic, payload }
}

module.exports = { buildRecord }
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd docker/mqtt-mongo && npx jest`
Expected: PASS — all five cases green.

- [ ] **Step 8: Wire `buildRecord` into index.js**

In `docker/mqtt-mongo/index.js`, add the require near the other requires (after line 6):

```javascript
const { buildRecord } = require('./record')
```

Then replace the message handler body (current lines 86-101) so record construction goes through `buildRecord`:

```javascript
            client.on('message', async function (topic, message) {
                const record = buildRecord(topic, message)
                try {
                    await col.insertOne(record)
                } catch (err) {
                    console.error('Failure writing to mongo', err)
                    process.exit(1)
                }
            })
```

- [ ] **Step 9: Verify index.js still parses**

Run: `cd docker/mqtt-mongo && node --check index.js`
Expected: exits 0, no output.

- [ ] **Step 10: Commit**

```bash
git add docker/mqtt-mongo/package.json docker/mqtt-mongo/package-lock.json \
        docker/mqtt-mongo/jest.config.js \
        docker/mqtt-mongo/record.js \
        docker/mqtt-mongo/__tests__/record.test.js \
        docker/mqtt-mongo/index.js
git commit -m "feat(mqtt-mongo): write BSON Date _ts for TTL support"
```

---

## Task 3: docker-compose service blocks

**Files:**
- Modify: `docker-compose.yml` (add `mqtt-mongo-ioniq` after the `mqtt-mongo-history` block ~line 667; add `mqtt-influx-ioniq` after the `mqtt-influx-dry-switches` block ~line 778).

**Interfaces:**
- Consumes: the `mqtt-mongo` and `mqtt-influx` images (with Task 1 & 2 changes) via `build:`.
- Produces: two running subscriber services (validated structurally here; live behavior is the Task 6 manual verification).

- [ ] **Step 1: Add the `mqtt-mongo-ioniq` block**

Insert directly after the `mqtt-mongo-history` block (mirrors it; only `COLLECTION`, `TOPIC`, `MQTT_CLIENT_ID` differ):

```yaml
  mqtt-mongo-ioniq:
    image: ghcr.io/groupsky/homy/mqtt-mongo:${IMAGE_TAG:-latest}
    build: docker/mqtt-mongo
    depends_on:
      - broker
      - mongo
    restart: unless-stopped
    networks:
      - automation
    security_opt:
      - no-new-privileges:true
    secrets:
      - mongo_root_username
      - mongo_root_password
    environment:
      - MONGODB_URL=mongodb://mongo:27017/${MONGO_DATABASE}?authSource=admin
      - MONGODB_USERNAME_FILE=/run/secrets/mongo_root_username
      - MONGODB_PASSWORD_FILE=/run/secrets/mongo_root_password
      - COLLECTION=ioniq
      - BROKER=mqtt://broker
      - TOPIC=ioniq/#
      - MQTT_CLIENT_ID=mqtt-mongo-ioniq
    logging:
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 2: Add the `mqtt-influx-ioniq` block**

Insert directly after the `mqtt-influx-dry-switches` block (mirrors it; drops `TAGS` per spec "no variant tag", and subscribes only to `ioniq/parsed/#`):

```yaml
  mqtt-influx-ioniq:
    image: ghcr.io/groupsky/homy/mqtt-influx:${IMAGE_TAG:-latest}
    build: docker/mqtt-influx
    depends_on:
      - broker
      - influxdb
    restart: unless-stopped
    networks:
      - automation
      - egress
    security_opt:
      - no-new-privileges:true
    secrets:
      - influxdb_write_user
      - influxdb_write_user_password
    environment:
      - BROKER=mqtt://broker
      - TOPIC=ioniq/parsed/#
      - MQTT_CLIENT_ID=mqtt-influx-ioniq
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_USERNAME_FILE=/run/secrets/influxdb_write_user
      - INFLUXDB_PASSWORD_FILE=/run/secrets/influxdb_write_user_password
      - INFLUXDB_DATABASE=${INFLUXDB_DATABASE}
    logging:
      options:
        max-size: "10m"
        max-file: "3"
```

- [ ] **Step 3: Validate compose structure**

Run: `docker compose --env-file example.env config >/dev/null && echo OK`
Expected: prints `OK`. (Unset-variable warnings for unrelated services are acceptable; a YAML/anchor error is not.) Confirm both new services appear:
Run: `docker compose --env-file example.env config --services | grep ioniq`
Expected: `mqtt-mongo-ioniq` and `mqtt-influx-ioniq`.

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): add ioniq mongo archive and influx bridge services"
```

---

## Task 4: Documentation & schema updates

**Files:**
- Modify: `docs/influxdb-schema.md`
- Modify: `docker/mqtt-influx/CLAUDE.md`
- Create: `docker/mqtt-mongo/CLAUDE.md`

**Interfaces:** none (documentation only).

- [ ] **Step 1: Document the `ioniq` measurement in `docs/influxdb-schema.md`**

Find the section that lists `mqtt-influx` / MQTT-sourced measurements and add an `ioniq` entry consistent with the surrounding format. Use this content (adapt heading level/numbering to the surrounding list):

```markdown
#### `ioniq` — Hyundai Ioniq OBD telemetry (mqtt-influx-ioniq)

- **Source**: `mqtt-influx-ioniq` bridge, subscribing to `ioniq/parsed/#`, converter `converters/ioniq.js` (`_type: "ioniq"`).
- **Tags**:
  - `group` — decoded frame group (e.g. `bms/2101`, `tpms`), from `payload.group`.
  - `state` — vehicle state (`active` / `parked` / `charging` / …), from `payload.state`.
- **Timestamp**: `payload.ts` (epoch ms), written at `ms` precision.
- **Fields**: every payload key except `_type`, `group`, `state`, `ts`. Numbers → float
  (uniformly, even integers, to avoid int/float conflicts); booleans → boolean; strings →
  string; nested objects → recursively flattened to dotted keys (`relays.main`); arrays →
  JSON-stringified string. Representative fields: `soc`, `hv_v`, `hv_a`, `12v`, `speed`,
  `relays.main`, `dtc`.
- **Retention**: kept indefinitely (compact numeric data). The bulky raw archive lives
  separately in Mongo (`ioniq` collection, 90-day TTL).
```

- [ ] **Step 2: Update `docker/mqtt-influx/CLAUDE.md`**

In the **Service Instances** list add:

```markdown
- **mqtt-influx-ioniq**: Hyundai Ioniq OBD telemetry (`ioniq/parsed/#`) → `ioniq` measurement
```

In the **Existing Converters** list add (keep alphabetical placement after `ex9em`):

```markdown
- **ioniq**: Hyundai Ioniq OBD telemetry — recursively-typed/flattened parsed frames into the `ioniq` measurement (tags `group`, `state`)
```

- [ ] **Step 3: Create `docker/mqtt-mongo/CLAUDE.md`**

```markdown
# CLAUDE.md - MQTT-Mongo Archive Service

This file provides guidance specific to the mqtt-mongo service for Claude Code.

## Service Overview

`mqtt-mongo` subscribes to an MQTT topic and stores every message verbatim in a
MongoDB collection as `{ topic, payload }`. It is a lossless archive used for
replay and ad-hoc queries. Multiple instances archive different topic trees.

### Service Instances
- **mqtt-mongo-history**: legacy temperature history (`/homy/br1/temp` → `history`).
- **mqtt-mongo-ioniq**: full Hyundai Ioniq OBD stream (`ioniq/#` → `ioniq`), covering
  parsed, raw, and status channels for replay / reverse-engineering.

## Record shape and timestamps

Each inserted document is `{ topic, payload }`. `record.js#buildRecord` enriches the
payload with two ingest timestamps when absent:

- `_tz` — epoch-ms **number** (historical field, kept for existing consumers).
- `_ts` — the same instant as a BSON **`Date`**. A MongoDB TTL index can expire only
  on a `Date` field, so `_ts` is what makes retention possible.

The logger's own event time remains available in `payload.ts`.

## Retention — one-time TTL index (mqtt-mongo-ioniq)

The Ioniq raw archive is capped at 90 days. Create the TTL index once against the
Mongo database (`MONGO_DATABASE`, default `power`). Mongo silently ignores
re-creation of an identical index, so this is safe to re-run:

    docker compose exec -T mongo mongosh \
      "mongodb://localhost:27017/${MONGO_DATABASE:-power}?authSource=admin" \
      -u "$(cat secrets/mongo_root_username)" -p "$(cat secrets/mongo_root_password)" \
      --eval 'db.ioniq.createIndex({ _ts: 1 }, { expireAfterSeconds: 7776000, name: "ttl__ts" })'

Verify:

    ... --eval 'db.ioniq.getIndexes()'

`expireAfterSeconds: 7776000` = 90 days. TTL uses ingest time (`_ts`); event time
stays in `payload.ts`. InfluxDB (`homy.ioniq`) is the long-term compact store and is
kept indefinitely.
```

- [ ] **Step 4: Commit**

```bash
git add docs/influxdb-schema.md docker/mqtt-influx/CLAUDE.md docker/mqtt-mongo/CLAUDE.md
git commit -m "docs(ioniq): schema, converter, and TTL runbook"
```

---

## Task 5: Verification before completion

**Files:** none (verification only).

- [ ] **Step 1: Run both full test suites and capture real output**

Run: `cd docker/mqtt-influx && npm test`
Run: `cd docker/mqtt-mongo && npm test`
Expected: both green; record the real pass counts.

- [ ] **Step 2: Re-validate compose config**

Run: `docker compose --env-file example.env config --services | grep ioniq`
Expected: both `mqtt-*-ioniq` services listed.

- [ ] **Step 3: Syntax-check the two modified entrypoints**

Run: `node --check docker/mqtt-influx/index.js && node --check docker/mqtt-mongo/index.js && echo OK`
Expected: `OK`.

- [ ] **Step 4: Confirm no stray files staged / lockfiles in sync**

Run: `git status --porcelain` and confirm only intended files changed; `npm ci --omit=dev` would still succeed (lockfiles updated in Tasks 1-2).

---

## Task 6: Manual end-to-end verification (documented, best-effort)

**Files:** none.

The spec's manual E2E (publish sample parsed/raw/status; confirm raw+status land in Mongo only, parsed lands in both, TTL index exists, `ioniq` measurement queryable) requires a running broker+Mongo+InfluxDB stack. If a stack is available, execute it; otherwise record it as the post-deploy runbook (the automated converter/record tests already prove the decode + `_ts` logic independent of the car). Do not block the PR on live infrastructure.

---

## Self-Review Notes

- **Spec coverage:** Component 1 (mqtt-mongo raw archive + `_ts` + TTL) → Tasks 2, 3, 4. Component 2 (mqtt-influx converter + service) → Tasks 1, 3. Converter contract (typing/flattening/arrays/tags/ts/defensive) → Task 1 tests. Testing requirements (Jest for converter + `_ts`) → Tasks 1, 2. Docs (schema, mqtt-influx CLAUDE, mqtt-mongo TTL) → Task 4. example.env → covered by Global Constraints (no new vars; confirmed). Out-of-scope items (Grafana dashboards, decoding ambiguous groups, multi-car) correctly excluded.
- **No placeholders:** every code/test/command step is concrete.
- **Type consistency:** `buildRecord(topic, message, now)` signature identical across Task 2 definition, tests, and index.js call site; `ioniq(data) => Point[]` identical across converter, tests, and index.js registration.
```
