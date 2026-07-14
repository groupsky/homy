# Ioniq EV Monitoring — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship phase-2 Ioniq EV monitoring — Grafana alert rules (battery, parked 12 V, DTC), the thin `ioniq-dtc` automations bot, an `Ioniq EV` Grafana folder, and Ioniq-scoped notification routing.

**Architecture:** Grafana owns threshold queries + notification delivery over the InfluxDB `ioniq` measurement. The `ioniq-dtc` bot handles the one array-logic condition (DTC `codes[]`): it publishes a clean numeric `derived/dtc_count` for Grafana to threshold, and additionally direct-flags a Telegram message (naming the codes) to `telegram-bridge` on a DTC edge. Connectivity/liveness is deferred to phase 3 (needs stateful session logic).

**Tech Stack:** Node.js 18 (automations bot, Jest tests, injected `fetch` for HTTP), Grafana provisioned alerting YAML (InfluxDB v1 / InfluxQL, `classic_conditions`), Alertmanager notification-policy YAML.

**Design doc:** `docs/superpowers/specs/2026-07-14-ioniq-monitoring-phase2-design.md`

## Global Constraints

- **Grafana alert rules:** `classic_conditions` only (never `threshold`); explicit `WHERE … AND time >= now() - <window>` in every InfluxQL query (never `$timeFilter`); datasource UID `P3C6603E967DC8568`; queries written as YAML block scalars (`query: |`) so inner `"…"`/`'…'` are literal; `noDataState: OK` on every rule; `execErrState: Alerting`; group `interval: 1m`; group header `folder: Ioniq EV`; `🚗` prefix in every `title` and `summary`; labels `severity` + `device: ioniq` + `subsystem`; no annotation may reference `{{ $labels.* }}` (classic_conditions drops GROUP BY labels — all rules here are single-series so use static text or `{{ $values.<refId>.Value }}`).
- **Verified prod facts (2026-07-14):** InfluxDB measurement `ioniq`, tags `group` + `state` (values `active`/`charging`/`parked`). Fields (bms/2101): `isolation_kohm`, `cell_min_v`, `cell_max_v`, `temp_max`, `avail_dis`, `soc`, `aux_12v`. Field (bms/2105): `soh`. DTC topics: `ioniq/parsed/dtc/stored`, `ioniq/parsed/dtc/pending`, each payload `{_type:'ioniq', group, state, ts, codes:[]}`.
- **Bot pattern:** `module.exports = (name, config) => ({ persistedCache?, start })`; `start: async ({ mqtt, persistedCache })`; `mqtt.subscribe(topic, cb)` delivers already-parsed objects; `mqtt.publish(topic, obj)` takes an object (framework adds `_bot`/`_tz` and serializes). Bot subscriptions are **exact-match** (no wildcards). Derived publishes MUST include `_type:'ioniq'` so the `mqtt-influx-ioniq` bridge accepts them.
- **Tests:** Jest via `cd docker/automations && npm test`; import globals from `@jest/globals`; mock MQTT with the `_triggerMessage`/`_callbacks` harness (see `bots/stateful-counter.test.js`); no real credentials/URLs beyond the internal service name.
- **Commits:** selective staging only (never `git add .` / `git add -A`). End each commit message body with `Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN`.

---

## File Structure

- `docker/automations/bots/ioniq-dtc.js` — the DTC bot (create).
- `docker/automations/bots/ioniq-dtc.test.js` — its Jest tests (create).
- `config/automations/config.js` — register the `ioniqDtc` bot instance (modify).
- `config/grafana/provisioning/alerting/ioniq-battery-alerts.yaml` — §4.1 non-derived battery rules (create).
- `config/grafana/provisioning/alerting/ioniq-12v-alerts.yaml` — §4.2 parked-12 V rules (create).
- `config/grafana/provisioning/alerting/ioniq-dtc-alerts.yaml` — §4.4 DTC rule (create).
- `config/grafana/provisioning/alerting/notification-policies.yaml` — add Ioniq-scoped routes (modify).
- `docs/influxdb-schema.md` — document the `derived/dtc_count` group (modify).
- `docs/ioniq-monitoring-alerting-spec.md` — mark phase-2 implementation status (modify).

---

## Task 1: `ioniq-dtc` bot — derived `dtc_count` signal

Compute the DTC count (union of stored+pending codes) and publish it as a clean numeric derived signal. No Telegram yet (Task 2).

**Files:**
- Create: `docker/automations/bots/ioniq-dtc.js`
- Test: `docker/automations/bots/ioniq-dtc.test.js`

**Interfaces:**
- Consumes: MQTT messages on `config.storedTopic` / `config.pendingTopic`, each an object `{ group, state, ts, codes: string[] }`.
- Produces: factory `createIoniqDtc(name, config) => ({ persistedCache, start })`. Publishes to `config.outputTopic` the object `{ _type:'ioniq', group:'derived/dtc_count', state, ts, value:<number>, codes:<string[]> }`. `persistedCache` shape `{ version:1, default:{ stored:[], pending:[], flaggedKey:'' } }`. Config keys: `storedTopic`, `pendingTopic`, `outputTopic` (all with the defaults shown in Task 3).

- [ ] **Step 1: Write the failing tests**

Create `docker/automations/bots/ioniq-dtc.test.js`:

```javascript
const { afterEach, beforeEach, describe, expect, it, jest } = require('@jest/globals')
const createIoniqDtc = require('./ioniq-dtc')

const STORED = 'ioniq/parsed/dtc/stored'
const PENDING = 'ioniq/parsed/dtc/pending'
const OUTPUT = 'ioniq/parsed/derived/dtc_count'

function makeMqtt () {
  const mqtt = {
    _callbacks: {},
    subscribe: jest.fn().mockImplementation((topic, cb) => {
      mqtt._callbacks[topic] = cb
      return Promise.resolve()
    }),
    publish: jest.fn().mockResolvedValue(),
    _trigger: (topic, message) =>
      mqtt._callbacks[topic] ? mqtt._callbacks[topic](message) : undefined
  }
  return mqtt
}

function makeCache () {
  return { stored: [], pending: [], flaggedKey: '' }
}

const config = {
  storedTopic: STORED,
  pendingTopic: PENDING,
  outputTopic: OUTPUT,
  httpPost: jest.fn().mockResolvedValue({ ok: true })
}

describe('ioniq-dtc bot — derived signal', () => {
  let mqtt, persistedCache, bot
  beforeEach(() => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    config.httpPost = jest.fn().mockResolvedValue({ ok: true })
    bot = createIoniqDtc('ioniq-dtc', config)
  })

  it('subscribes to both dtc topics', async () => {
    await bot.start({ mqtt, persistedCache })
    expect(mqtt.subscribe).toHaveBeenCalledWith(STORED, expect.any(Function))
    expect(mqtt.subscribe).toHaveBeenCalledWith(PENDING, expect.any(Function))
  })

  it('publishes value 0 with empty codes and no flag', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'parked', ts: 100, codes: [] })
    expect(mqtt.publish).toHaveBeenCalledWith(OUTPUT, {
      _type: 'ioniq', group: 'derived/dtc_count', state: 'parked', ts: 100, value: 0, codes: []
    })
    expect(config.httpPost).not.toHaveBeenCalled()
  })

  it('publishes the count and union of codes when a DTC appears', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 200, codes: ['P0AA6'] })
    expect(mqtt.publish).toHaveBeenLastCalledWith(OUTPUT, {
      _type: 'ioniq', group: 'derived/dtc_count', state: 'active', ts: 200, value: 1, codes: ['P0AA6']
    })
  })

  it('unions stored and pending, de-duplicating shared codes', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 300, codes: ['P0AA6', 'P1B76'] })
    await mqtt._trigger(PENDING, { group: 'dtc/pending', state: 'active', ts: 301, codes: ['P1B76', 'C1611'] })
    expect(mqtt.publish).toHaveBeenLastCalledWith(OUTPUT, {
      _type: 'ioniq', group: 'derived/dtc_count', state: 'active', ts: 301, value: 3,
      codes: ['P0AA6', 'P1B76', 'C1611']
    })
  })

  it('treats a missing codes field as empty', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'parked', ts: 400 })
    expect(mqtt.publish).toHaveBeenLastCalledWith(OUTPUT, expect.objectContaining({ value: 0, codes: [] }))
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd docker/automations && npx jest bots/ioniq-dtc.test.js`
Expected: FAIL — `Cannot find module './ioniq-dtc'`.

- [ ] **Step 3: Write the minimal bot implementation**

Create `docker/automations/bots/ioniq-dtc.js`:

```javascript
// ioniq-dtc: reduces the Ioniq DTC arrays (stored + pending) to a numeric
// derived/dtc_count signal for Grafana, and (Task 2) direct-flags new codes to Telegram.
async function defaultHttpPost (url, body) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
}

module.exports = function createIoniqDtc (name, config) {
  const storedTopic = config.storedTopic || 'ioniq/parsed/dtc/stored'
  const pendingTopic = config.pendingTopic || 'ioniq/parsed/dtc/pending'
  const outputTopic = config.outputTopic || 'ioniq/parsed/derived/dtc_count'

  return {
    persistedCache: {
      version: 1,
      default: { stored: [], pending: [], flaggedKey: '' }
    },

    start: async ({ mqtt, persistedCache }) => {
      const handle = (which) => (payload) => {
        const codes = Array.isArray(payload && payload.codes) ? payload.codes : []
        persistedCache[which] = codes

        const union = [...new Set([...persistedCache.stored, ...persistedCache.pending])]
        mqtt.publish(outputTopic, {
          _type: 'ioniq',
          group: 'derived/dtc_count',
          state: payload && payload.state,
          ts: payload && payload.ts,
          value: union.length,
          codes: union
        })
      }

      await mqtt.subscribe(storedTopic, handle('stored'))
      await mqtt.subscribe(pendingTopic, handle('pending'))
    }
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd docker/automations && npx jest bots/ioniq-dtc.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add docker/automations/bots/ioniq-dtc.js docker/automations/bots/ioniq-dtc.test.js
git commit -m "$(cat <<'MSG'
feat(automations): add ioniq-dtc bot deriving dtc_count signal

Subscribes to ioniq/parsed/dtc/{stored,pending}, unions the code
arrays, and publishes a numeric ioniq/parsed/derived/dtc_count for
Grafana to threshold.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Task 2: `ioniq-dtc` bot — direct-flag new DTCs to Telegram

Add the "both notify" direct-flag: on a DTC edge (a new non-empty code set), POST a code-naming message to `telegram-bridge`, deduped across restarts via `persistedCache.flaggedKey`.

**Files:**
- Modify: `docker/automations/bots/ioniq-dtc.js`
- Test: `docker/automations/bots/ioniq-dtc.test.js`

**Interfaces:**
- Consumes: same MQTT messages as Task 1, plus config `telegramWebhookUrl` (default `http://telegram-bridge:3000/webhook`), `flagOnEdge` (default `true`), and injectable `httpPost(url, body)` (default `defaultHttpPost`, used in prod; tests pass a mock).
- Produces: on a 0→N or N→different-set transition, one `httpPost(telegramWebhookUrl, { message })` where `message` is `🚗 <b>DTC present</b>: <code> (stored|pending), …`. Resets the dedupe key when the set returns to empty. HTTP failures are caught and never crash the bot.

- [ ] **Step 1: Add the failing direct-flag tests**

Append to `docker/automations/bots/ioniq-dtc.test.js` (new `describe` block):

```javascript
describe('ioniq-dtc bot — direct flag', () => {
  let mqtt, persistedCache, bot
  beforeEach(() => {
    mqtt = makeMqtt()
    persistedCache = makeCache()
    config.httpPost = jest.fn().mockResolvedValue({ ok: true })
    config.telegramWebhookUrl = 'http://telegram-bridge:3000/webhook'
    bot = createIoniqDtc('ioniq-dtc', config)
  })

  it('flags once when a DTC appears, naming the code and source', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    expect(config.httpPost).toHaveBeenCalledTimes(1)
    expect(config.httpPost).toHaveBeenCalledWith(
      'http://telegram-bridge:3000/webhook',
      { message: '🚗 <b>DTC present</b>: P0AA6 (stored)' }
    )
  })

  it('does not re-flag the same code set on repeated samples', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 2, codes: ['P0AA6'] })
    expect(config.httpPost).toHaveBeenCalledTimes(1)
  })

  it('flags again after the codes clear and a new DTC appears', async () => {
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 2, codes: [] })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 3, codes: ['P0AA6'] })
    expect(config.httpPost).toHaveBeenCalledTimes(2)
  })

  it('does not re-flag a code set already flagged before restart', async () => {
    persistedCache.stored = ['P0AA6']
    persistedCache.flaggedKey = 'P0AA6'
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 5, codes: ['P0AA6'] })
    expect(config.httpPost).not.toHaveBeenCalled()
  })

  it('still publishes the derived signal when the HTTP flag fails', async () => {
    config.httpPost = jest.fn().mockRejectedValue(new Error('bridge down'))
    bot = createIoniqDtc('ioniq-dtc', config)
    await bot.start({ mqtt, persistedCache })
    await expect(
      mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    ).resolves.not.toThrow()
    expect(mqtt.publish).toHaveBeenCalledWith(OUTPUT, expect.objectContaining({ value: 1 }))
  })

  it('never flags when flagOnEdge is false', async () => {
    config.flagOnEdge = false
    bot = createIoniqDtc('ioniq-dtc', config)
    await bot.start({ mqtt, persistedCache })
    await mqtt._trigger(STORED, { group: 'dtc/stored', state: 'active', ts: 1, codes: ['P0AA6'] })
    expect(config.httpPost).not.toHaveBeenCalled()
    delete config.flagOnEdge
  })
})
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd docker/automations && npx jest bots/ioniq-dtc.test.js`
Expected: the Task-1 tests still PASS; the six new direct-flag tests FAIL (`httpPost` never called / no dedupe).

- [ ] **Step 3: Implement the direct-flag logic**

Replace the body of `module.exports` in `docker/automations/bots/ioniq-dtc.js` with:

```javascript
module.exports = function createIoniqDtc (name, config) {
  const storedTopic = config.storedTopic || 'ioniq/parsed/dtc/stored'
  const pendingTopic = config.pendingTopic || 'ioniq/parsed/dtc/pending'
  const outputTopic = config.outputTopic || 'ioniq/parsed/derived/dtc_count'
  const telegramWebhookUrl = config.telegramWebhookUrl || 'http://telegram-bridge:3000/webhook'
  const flagOnEdge = config.flagOnEdge !== false
  const httpPost = config.httpPost || defaultHttpPost
  const log = (...args) => { if (config.verbose) console.log(`[${name}]`, ...args) }

  const keyOf = (codes) => codes.slice().sort().join(',')

  return {
    persistedCache: {
      version: 1,
      default: { stored: [], pending: [], flaggedKey: '' }
    },

    start: async ({ mqtt, persistedCache }) => {
      const handle = (which) => async (payload) => {
        const codes = Array.isArray(payload && payload.codes) ? payload.codes : []
        persistedCache[which] = codes

        const union = [...new Set([...persistedCache.stored, ...persistedCache.pending])]
        mqtt.publish(outputTopic, {
          _type: 'ioniq',
          group: 'derived/dtc_count',
          state: payload && payload.state,
          ts: payload && payload.ts,
          value: union.length,
          codes: union
        })

        if (union.length === 0) {
          persistedCache.flaggedKey = ''
          return
        }

        const key = keyOf(union)
        if (flagOnEdge && key !== persistedCache.flaggedKey) {
          persistedCache.flaggedKey = key
          const parts = union.map((code) =>
            `${code} (${persistedCache.stored.includes(code) ? 'stored' : 'pending'})`)
          const message = `🚗 <b>DTC present</b>: ${parts.join(', ')}`
          try {
            await httpPost(telegramWebhookUrl, { message })
          } catch (err) {
            log('direct-flag POST failed:', err && err.message)
          }
        }
      }

      await mqtt.subscribe(storedTopic, handle('stored'))
      await mqtt.subscribe(pendingTopic, handle('pending'))
    }
  }
}
```

(Keep the `defaultHttpPost` helper at the top of the file from Task 1.)

- [ ] **Step 4: Run the full bot test file to verify all pass**

Run: `cd docker/automations && npx jest bots/ioniq-dtc.test.js`
Expected: PASS (all 10 tests).

- [ ] **Step 5: Run the whole automations suite to check for regressions**

Run: `cd docker/automations && npm test`
Expected: PASS (existing suite unaffected).

- [ ] **Step 6: Commit**

```bash
git add docker/automations/bots/ioniq-dtc.js docker/automations/bots/ioniq-dtc.test.js
git commit -m "$(cat <<'MSG'
feat(automations): ioniq-dtc direct-flags new DTCs to telegram-bridge

On a DTC edge (new non-empty code set) POST a code-naming message to
telegram-bridge, deduped across restarts via persistedCache.flaggedKey.
HTTP uses an injectable poster (default fetch); failures are caught so
the derived publish always happens.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Task 3: Register the `ioniq-dtc` bot in config

Wire the bot instance so it runs in production.

**Files:**
- Modify: `config/automations/config.js`

**Interfaces:**
- Consumes: the `createIoniqDtc` factory (resolved by `index.js` from `type: 'ioniq-dtc'`).
- Produces: a running `ioniqDtc` bot instance with the verified topics.

- [ ] **Step 1: Add the bot registration**

In `config/automations/config.js`, add this entry inside the `bots: { … }` object (place it alongside the other bot instances, before the object's closing brace):

```javascript
    ioniqDtc: {
      type: 'ioniq-dtc',
      storedTopic: 'ioniq/parsed/dtc/stored',
      pendingTopic: 'ioniq/parsed/dtc/pending',
      outputTopic: 'ioniq/parsed/derived/dtc_count',
      telegramWebhookUrl: 'http://telegram-bridge:3000/webhook',
    },
```

- [ ] **Step 2: Verify the config file still parses**

Run: `cd docker/automations && node -e "const c = require('../../config/automations/config.js'); if (!c.bots.ioniqDtc) throw new Error('ioniqDtc missing'); if (c.bots.ioniqDtc.type !== 'ioniq-dtc') throw new Error('wrong type'); console.log('config OK: ioniqDtc registered')"`
Expected: prints `config OK: ioniqDtc registered` and exits 0.

- [ ] **Step 3: Commit**

```bash
git add config/automations/config.js
git commit -m "$(cat <<'MSG'
feat(automations): register ioniq-dtc bot instance

Wire ioniqDtc with the prod-verified dtc topics and the telegram-bridge
webhook URL.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Task 4: Grafana battery alert rules (§4.1 non-derived)

**Files:**
- Create: `config/grafana/provisioning/alerting/ioniq-battery-alerts.yaml`

**Interfaces:**
- Consumes: InfluxDB `ioniq` measurement fields `isolation_kohm`, `cell_min_v`, `cell_max_v`, `temp_max` (group `bms/2101`), `soh` (group `bms/2105`), and the two-query pair `avail_dis`+`soc` (group `bms/2101`).
- Produces: 10 alert rules in folder `Ioniq EV`, group `Ioniq Battery Alerts`.

- [ ] **Step 1: Write the rule file**

Create `config/grafana/provisioning/alerting/ioniq-battery-alerts.yaml`:

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: Ioniq Battery Alerts
    folder: Ioniq EV
    interval: 1m
    rules:
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
        noDataState: OK
        execErrState: Alerting
        for: 10m
        labels: { severity: warning, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 HV isolation resistance below 500 kΩ"
          description: "Possible HV leak to chassis. Investigate before driving if it keeps falling."

      - uid: ioniq-isolation-critical
        title: "🚗 Ioniq HV Isolation Critical"
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
                - evaluator: { type: lt, params: [100] }
                  operator: { type: and }
                  query: { params: [iso] }
                  reducer: { type: last }
                  type: query
              expression: iso
        noDataState: OK
        execErrState: Alerting
        for: 10m
        labels: { severity: critical, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 HV isolation resistance below 100 kΩ"
          description: "HV isolation at/under the rated minimum. Do not fast-charge; book HV inspection."

      - uid: ioniq-cell-min-low
        title: "🚗 Ioniq Min Cell Voltage Low"
        condition: A
        data:
          - refId: cmin
            relativeTimeRange: { from: 300, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("cell_min_v") FROM "ioniq"
                WHERE "group"='bms/2101' AND time >= now() - 5m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [3.0] }
                  operator: { type: and }
                  query: { params: [cmin] }
                  reducer: { type: last }
                  type: query
              expression: cmin
        noDataState: OK
        execErrState: Alerting
        for: 1m
        labels: { severity: warning, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Minimum cell voltage below 3.0 V"
          description: "A cell is running low. Monitor; read a full cell dump if it persists."

      - uid: ioniq-cell-min-critical
        title: "🚗 Ioniq Min Cell Voltage Critical"
        condition: A
        data:
          - refId: cmin
            relativeTimeRange: { from: 300, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("cell_min_v") FROM "ioniq"
                WHERE "group"='bms/2101' AND time >= now() - 5m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [2.5] }
                  operator: { type: and }
                  query: { params: [cmin] }
                  reducer: { type: last }
                  type: query
              expression: cmin
        noDataState: OK
        execErrState: Alerting
        for: 1m
        labels: { severity: critical, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Minimum cell voltage below 2.5 V"
          description: "Cell under-voltage. Stop charging/driving; read DTC + cell dump; service."

      - uid: ioniq-cell-max-critical
        title: "🚗 Ioniq Max Cell Voltage Critical"
        condition: A
        data:
          - refId: cmax
            relativeTimeRange: { from: 300, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("cell_max_v") FROM "ioniq"
                WHERE "group"='bms/2101' AND time >= now() - 5m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gt, params: [4.15] }
                  operator: { type: and }
                  query: { params: [cmax] }
                  reducer: { type: last }
                  type: query
              expression: cmax
        noDataState: OK
        execErrState: Alerting
        for: 1m
        labels: { severity: critical, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Maximum cell voltage above 4.15 V"
          description: "Cell over-voltage. Stop charging; read DTC + cell dump; service."

      - uid: ioniq-pack-temp-high
        title: "🚗 Ioniq Pack Temperature High"
        condition: A
        data:
          - refId: tmax
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("temp_max") FROM "ioniq"
                WHERE "group"='bms/2101' AND time >= now() - 10m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gt, params: [45] }
                  operator: { type: and }
                  query: { params: [tmax] }
                  reducer: { type: last }
                  type: query
              expression: tmax
        noDataState: OK
        execErrState: Alerting
        for: 5m
        labels: { severity: warning, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Pack temperature above 45 °C"
          description: "Battery running hot. Avoid fast-charging until it cools."

      - uid: ioniq-pack-temp-critical
        title: "🚗 Ioniq Pack Temperature Critical"
        condition: A
        data:
          - refId: tmax
            relativeTimeRange: { from: 600, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("temp_max") FROM "ioniq"
                WHERE "group"='bms/2101' AND time >= now() - 10m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gt, params: [55] }
                  operator: { type: and }
                  query: { params: [tmax] }
                  reducer: { type: last }
                  type: query
              expression: tmax
        noDataState: OK
        execErrState: Alerting
        for: 5m
        labels: { severity: critical, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Pack temperature above 55 °C"
          description: "Pack over-temp. Stop charging/driving; investigate cooling."

      - uid: ioniq-soh-step
        title: "🚗 Ioniq State of Health Reduced"
        condition: A
        data:
          - refId: soh
            relativeTimeRange: { from: 86400, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("soh") FROM "ioniq"
                WHERE "group"='bms/2105' AND time >= now() - 24h
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [98] }
                  operator: { type: and }
                  query: { params: [soh] }
                  reducer: { type: last }
                  type: query
              expression: soh
        noDataState: OK
        execErrState: Alerting
        for: 1h
        labels: { severity: warning, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Battery SoH dropped below 98%"
          description: "Capacity fade step. Log and compare against warranty threshold over time."

      - uid: ioniq-soh-critical
        title: "🚗 Ioniq State of Health Critical"
        condition: A
        data:
          - refId: soh
            relativeTimeRange: { from: 86400, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("soh") FROM "ioniq"
                WHERE "group"='bms/2105' AND time >= now() - 24h
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [85] }
                  operator: { type: and }
                  query: { params: [soh] }
                  reducer: { type: last }
                  type: query
              expression: soh
        noDataState: OK
        execErrState: Alerting
        for: 1h
        labels: { severity: critical, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Battery SoH below 85%"
          description: "Significant capacity fade. Compare to warranty replacement threshold."

      - uid: ioniq-avail-dis-derate
        title: "🚗 Ioniq Available Discharge Derated"
        condition: A
        data:
          - refId: disq
            relativeTimeRange: { from: 900, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("avail_dis") FROM "ioniq"
                WHERE "group"='bms/2101' AND time >= now() - 15m
              rawQuery: true
              resultFormat: time_series
          - refId: socq
            relativeTimeRange: { from: 900, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("soc") FROM "ioniq"
                WHERE "group"='bms/2101' AND time >= now() - 15m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [70] }
                  operator: { type: and }
                  query: { params: [disq] }
                  reducer: { type: last }
                  type: query
                - evaluator: { type: gt, params: [30] }
                  operator: { type: and }
                  query: { params: [socq] }
                  reducer: { type: last }
                  type: query
              expression: disq
        noDataState: OK
        execErrState: Alerting
        for: 15m
        labels: { severity: warning, device: ioniq, subsystem: battery }
        annotations:
          summary: "🚗 Available discharge power derated below 70 kW"
          description: "BMS is limiting discharge while SoC is healthy (>30%). Watch for a developing pack fault."
```

- [ ] **Step 2: Validate the YAML parses and has the expected rules**

Run:
```bash
cd /home/groupsky/src/homy && python3 -c "
import yaml, sys
d = yaml.safe_load(open('config/grafana/provisioning/alerting/ioniq-battery-alerts.yaml'))
g = d['groups'][0]
assert g['folder']=='Ioniq EV', g['folder']
assert g['interval']=='1m'
rules = g['rules']
assert len(rules)==10, len(rules)
for r in rules:
    assert r['noDataState']=='OK', r['uid']
    assert r['execErrState']=='Alerting', r['uid']
    assert r['labels']['device']=='ioniq', r['uid']
    assert r['condition']=='A', r['uid']
    assert r['title'].startswith('🚗'), r['uid']
uids={r['uid'] for r in rules}
assert 'ioniq-avail-dis-derate' in uids
# multi-condition rule has two conditions
mc=[r for r in rules if r['uid']=='ioniq-avail-dis-derate'][0]
conds=[d for d in mc['data'] if d['refId']=='A'][0]['model']['conditions']
assert len(conds)==2, len(conds)
print('battery YAML OK:', len(rules), 'rules')
"
```
Expected: `battery YAML OK: 10 rules`.

- [ ] **Step 3: Commit**

```bash
git add config/grafana/provisioning/alerting/ioniq-battery-alerts.yaml
git commit -m "$(cat <<'MSG'
feat(grafana): add Ioniq battery alert rules

HV isolation, min/max cell voltage, pack temperature, static SoH steps,
and an available-discharge derate rule (multi-condition avail_dis<70 AND
soc>30) in the new Ioniq EV folder. noDataState OK throughout so a
sleeping car does not alert.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Task 5: Grafana parked-12 V alert rules (§4.2)

**Files:**
- Create: `config/grafana/provisioning/alerting/ioniq-12v-alerts.yaml`

**Interfaces:**
- Consumes: InfluxDB `ioniq` field `aux_12v` (group `bms/2101`) with the `state='parked'` tag filter.
- Produces: 2 alert rules in folder `Ioniq EV`, group `Ioniq 12V Alerts`.

- [ ] **Step 1: Write the rule file**

Create `config/grafana/provisioning/alerting/ioniq-12v-alerts.yaml`:

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: Ioniq 12V Alerts
    folder: Ioniq EV
    interval: 1m
    rules:
      - uid: ioniq-12v-low-parked
        title: "🚗 Ioniq 12V Low (parked)"
        condition: A
        data:
          - refId: v12
            relativeTimeRange: { from: 900, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("aux_12v") FROM "ioniq"
                WHERE "group"='bms/2101' AND "state"='parked' AND time >= now() - 15m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [12.2] }
                  operator: { type: and }
                  query: { params: [v12] }
                  reducer: { type: last }
                  type: query
              expression: v12
        noDataState: OK
        execErrState: Alerting
        for: 1m
        labels: { severity: warning, device: ioniq, subsystem: 12v }
        annotations:
          summary: "🚗 12V battery below 12.2 V while parked"
          description: "Aux 12V is dropping at rest. Charge/replace before the next lock cycle — a dead 12V strands the car."

      - uid: ioniq-12v-critical-parked
        title: "🚗 Ioniq 12V Critical (parked)"
        condition: A
        data:
          - refId: v12
            relativeTimeRange: { from: 900, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("aux_12v") FROM "ioniq"
                WHERE "group"='bms/2101' AND "state"='parked' AND time >= now() - 15m
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [11.8] }
                  operator: { type: and }
                  query: { params: [v12] }
                  reducer: { type: last }
                  type: query
              expression: v12
        noDataState: OK
        execErrState: Alerting
        for: 1m
        labels: { severity: critical, device: ioniq, subsystem: 12v }
        annotations:
          summary: "🚗 12V battery below 11.8 V while parked"
          description: "Aux 12V critically low at rest. Charge/replace now to avoid stranding."
```

- [ ] **Step 2: Validate the YAML**

Run:
```bash
cd /home/groupsky/src/homy && python3 -c "
import yaml
d = yaml.safe_load(open('config/grafana/provisioning/alerting/ioniq-12v-alerts.yaml'))
g = d['groups'][0]
assert g['folder']=='Ioniq EV'
rules = g['rules']
assert len(rules)==2, len(rules)
for r in rules:
    assert r['noDataState']=='OK'
    assert r['labels']['subsystem']=='12v'
    q = [x for x in r['data'] if x['refId']=='v12'][0]['model']['query']
    assert \"\\\"state\\\"='parked'\" in q, q
print('12V YAML OK')
"
```
Expected: `12V YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add config/grafana/provisioning/alerting/ioniq-12v-alerts.yaml
git commit -m "$(cat <<'MSG'
feat(grafana): add Ioniq parked-12V alert rules

Warn <12.2V / critical <11.8V on aux_12v filtered to state='parked' so
normal float-under-traction voltages do not false-fire. noDataState OK
(no parked samples while driving is not an alert).

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Task 6: Grafana DTC alert rule (§4.4)

**Files:**
- Create: `config/grafana/provisioning/alerting/ioniq-dtc-alerts.yaml`

**Interfaces:**
- Consumes: the bot's `derived/dtc_count` signal (field `value`, group `derived/dtc_count`).
- Produces: 1 alert rule in folder `Ioniq EV`, group `Ioniq DTC Alerts`.

- [ ] **Step 1: Write the rule file**

Create `config/grafana/provisioning/alerting/ioniq-dtc-alerts.yaml`:

```yaml
apiVersion: 1

groups:
  - orgId: 1
    name: Ioniq DTC Alerts
    folder: Ioniq EV
    interval: 1m
    rules:
      - uid: ioniq-dtc-present
        title: "🚗 Ioniq Diagnostic Trouble Code"
        condition: A
        data:
          - refId: dtc
            relativeTimeRange: { from: 3600, to: 0 }
            datasourceUid: P3C6603E967DC8568
            model:
              query: |
                SELECT last("value") FROM "ioniq"
                WHERE "group"='derived/dtc_count' AND time >= now() - 1h
              rawQuery: true
              resultFormat: time_series
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gt, params: [0] }
                  operator: { type: and }
                  query: { params: [dtc] }
                  reducer: { type: last }
                  type: query
              expression: dtc
        noDataState: OK
        execErrState: Alerting
        for: 0s
        labels: { severity: critical, device: ioniq, subsystem: dtc }
        annotations:
          summary: "🚗 Diagnostic trouble code(s) present: {{ $values.dtc.Value }} active"
          description: "The car reported one or more DTCs. The Telegram flag from the ioniq-dtc bot names the specific code(s); decode and act by code."
```

- [ ] **Step 2: Validate the YAML**

Run:
```bash
cd /home/groupsky/src/homy && python3 -c "
import yaml
d = yaml.safe_load(open('config/grafana/provisioning/alerting/ioniq-dtc-alerts.yaml'))
r = d['groups'][0]['rules'][0]
assert r['uid']=='ioniq-dtc-present'
assert r['labels']['severity']=='critical'
assert r['for']=='0s'
assert r['noDataState']=='OK'
q=[x for x in r['data'] if x['refId']=='dtc'][0]['model']['query']
assert \"'derived/dtc_count'\" in q, q
print('DTC YAML OK')
"
```
Expected: `DTC YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add config/grafana/provisioning/alerting/ioniq-dtc-alerts.yaml
git commit -m "$(cat <<'MSG'
feat(grafana): add Ioniq DTC alert rule

Critical alert when derived/dtc_count > 0 (from the ioniq-dtc bot).
Fires immediately; the bot's direct-flag names the specific codes.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Task 7: Ioniq-scoped notification routing (§3)

Add severity-based routes matched on `device = ioniq` so Ioniq alerts get their own cadence without touching house-alert behaviour.

**Files:**
- Modify: `config/grafana/provisioning/alerting/notification-policies.yaml`

**Interfaces:**
- Consumes: the existing `telegram-webhook` receiver and the `device: ioniq` / `severity` labels emitted by the rules in Tasks 4–6.
- Produces: three child routes under the existing root policy; non-Ioniq alerts fall through unchanged.

- [ ] **Step 1: Replace the file with the routed version**

Overwrite `config/grafana/provisioning/alerting/notification-policies.yaml` with:

```yaml
apiVersion: 1

policies:
  - orgId: 1
    receiver: telegram-webhook
    group_by:
      - grafana_folder
      - alertname
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
    routes:
      - receiver: telegram-webhook
        matchers:
          - device = ioniq
          - severity = critical
        group_wait: 10s
        group_interval: 1m
        repeat_interval: 1h
      - receiver: telegram-webhook
        matchers:
          - device = ioniq
          - severity = warning
        group_wait: 1m
        group_interval: 5m
        repeat_interval: 12h
      - receiver: telegram-webhook
        matchers:
          - device = ioniq
          - severity = info
        group_wait: 5m
        group_interval: 30m
        repeat_interval: 24h
```

- [ ] **Step 2: Validate the YAML and route isolation**

Run:
```bash
cd /home/groupsky/src/homy && python3 -c "
import yaml
d = yaml.safe_load(open('config/grafana/provisioning/alerting/notification-policies.yaml'))
root = d['policies'][0]
assert root['receiver']=='telegram-webhook'
assert root['repeat_interval']=='4h'   # house alerts unchanged
routes = root['routes']
assert len(routes)==3, len(routes)
for r in routes:
    assert 'device = ioniq' in r['matchers'], r['matchers']
    assert r['receiver']=='telegram-webhook'
    assert 'continue' not in r or r['continue'] is False
sev = {m for r in routes for m in r['matchers'] if m.startswith('severity')}
assert sev == {'severity = critical','severity = warning','severity = info'}, sev
print('routing YAML OK')
"
```
Expected: `routing YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add config/grafana/provisioning/alerting/notification-policies.yaml
git commit -m "$(cat <<'MSG'
feat(grafana): Ioniq-scoped severity notification routes

Add device=ioniq + severity child routes (critical 1h / warning 12h /
info 24h repeat) under the existing flat root policy. Non-Ioniq alerts
match no child route and keep the unchanged 4h root behaviour — zero
blast radius.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Task 8: Documentation updates

**Files:**
- Modify: `docs/influxdb-schema.md`
- Modify: `docs/ioniq-monitoring-alerting-spec.md`

**Interfaces:**
- Consumes: nothing (docs only).
- Produces: schema entry for the new `derived/dtc_count` group and a phase-2 status note in the parent spec.

- [ ] **Step 1: Document the derived group in the InfluxDB schema**

In `docs/influxdb-schema.md`, in the `ioniq` measurement section (around the `group` tag description near lines 186–201), add a note that a new bot-produced group exists:

```markdown
- **`derived/dtc_count`** (tag `group`) — produced by the `ioniq-dtc` automations bot, not the
  logger. Field `value` = count of active DTCs (union of `dtc/stored` + `dtc/pending`); field
  `codes` = JSON-stringified array of the code strings. Grafana's `ioniq-dtc-present` rule alerts
  on `value > 0`.
```

- [ ] **Step 2: Add a phase-2 implementation-status note to the parent spec**

In `docs/ioniq-monitoring-alerting-spec.md`, under the `## 9. Rollout phases` section, append:

```markdown
> **Implementation status (2026-07-14):** Phase 2 is implemented on branch
> `feat/ioniq-monitoring-phase2` — Grafana battery (§4.1 non-derived), parked-12 V (§4.2), and
> DTC (§4.4) alert rules; the `ioniq-dtc` bot (derived `dtc_count` + direct-flag); the `Ioniq EV`
> folder; and Ioniq-scoped notification routing (§3, scoped to `device = ioniq` rather than the
> house-wide reroute). Connectivity/liveness (§4.5) is deferred to phase 3: a `count()`-based
> Grafana rule cannot express it (empty window returns no row, not 0) and NoData would fire on
> every normal park, so it needs a session-aware bot. See
> `docs/superpowers/specs/2026-07-14-ioniq-monitoring-phase2-design.md`.
```

- [ ] **Step 3: Verify both edits landed**

Run:
```bash
cd /home/groupsky/src/homy && grep -q 'derived/dtc_count' docs/influxdb-schema.md && grep -q 'Implementation status (2026-07-14)' docs/ioniq-monitoring-alerting-spec.md && echo 'docs OK'
```
Expected: `docs OK`.

- [ ] **Step 4: Commit**

```bash
git add docs/influxdb-schema.md docs/ioniq-monitoring-alerting-spec.md
git commit -m "$(cat <<'MSG'
docs(ioniq): document derived/dtc_count group and phase-2 status

Add the bot-produced derived/dtc_count group to the InfluxDB schema and
record phase-2 implementation status (with the connectivity deferral) in
the monitoring spec.

Claude-Session: https://claude.ai/code/session_01Nk34deVYZngF9BUeWJ6oJN
MSG
)"
```

---

## Final verification (after all tasks)

- [ ] Run the full automations test suite: `cd docker/automations && npm test` — all pass.
- [ ] Confirm all 4 new/modified Grafana YAML files parse (Tasks 4–7 validation steps).
- [ ] `git log --oneline` shows one commit per task, all on `feat/ioniq-monitoring-phase2`.
- [ ] Optional live smoke test (needs a running Grafana): provision the folder and confirm the multi-condition `ioniq-avail-dis-derate` rule loads without a "condition must not be empty" error, since multi-condition `classic_conditions` is new to this repo.

## Notes for the executor

- **Do not** add connectivity/liveness rules — deferred to phase 3 by design decision.
- **Do not** introduce MSW or any new npm dependency for the bot's HTTP; the injected `httpPost` (default `fetch`) is intentional.
- The `for: 0s` on the DTC rule is deliberate (immediate). All other `for:` values are ≥ the 1m group interval.
- If `python3`/`PyYAML` is unavailable in the environment, substitute an equivalent Node YAML check (e.g. `npx js-yaml <file>`), but do not add a dependency to a service's `package.json` just for validation.
