# Ioniq TPMS Nested-Payload Bugfix Implementation Plan (PR0)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix `ioniq-tpms` so it reads the real **nested** tpms payload, restoring the `derived/tire_*` signals that have never once emitted and reviving the dead Phase-3 tpms alert rules.

**Architecture:** The bot subscribes to `ioniq/parsed/tpms` and reads per-wheel values as **flat** keys (`payload['fl.psi']`). The live payload is **nested** (`payload.fl.psi`), so every read yields `undefined` and the bot never calls `publish()`. The fix normalizes the nested payload into the bot's existing flat internal `raw` fingerprint once, at the top of the handler; the remaining logic then reads from `raw` and is otherwise untouched. This keeps the diff minimal and the persisted-cache shape stable (no version bump).

**Tech Stack:** Node.js, Jest, MQTT (`docker/automations`), `fast-json-stable-stringify`.

## Global Constraints

- **Output signal names are unchanged:** `tire_<w>_psi_cold`, `tire_spread_psi`, `tire_<w>_temp_excess`; group `derived/<name>`; field `value`. Alert rules from #1387 depend on these exactly.
- **Wheels:** `w ∈ {fl, fr, rl, rr}`. Constants unchanged: `TEMP_COEFF = 0.18` psi/°C, `REF_TEMP_C = 15`.
- **TDD is mandatory:** tests must be converted to nested fixtures and **observed failing** before the implementation change, and passing after.
- **Scope:** `docker/automations/bots/ioniq-tpms.js` + `ioniq-tpms.test.js` only. Do **not** touch the cell-health `3800 mV` issue (tracked as a separate follow-up), alert rules, or `config/automations/config.js`.
- **`persistedCache.version` stays `1`.** The internal `raw` fingerprint keeps its flat key names (`'fl.psi'`), so the persisted shape is unchanged and no migration is needed. (Prod's stored `lastRaw` is literally `{}` on disk: the buggy bot wrote all-`undefined` values and `state-manager.js` persists via `fast-json-stable-stringify`, which strips undefined-valued keys at write time. Note `{}` is **truthy**, so the dedupe guard *is* entered on the first post-deploy frame — it simply never matches, because `stringify({})` is `"{}"` while any frame with at least one finite wheel value stringifies to a non-empty object. So a stale cache cannot suppress the first real emit. Do not "simplify" the guard to `lastRaw !== null` on the assumption it is skipped.)
- **Commits:** selective staging only (never `git add .`). Every commit body ends with the Claude-Session trailer.
- **Branch from `docs/ioniq-phase4-dashboards-spec`** (NOT master) and carry the spec + plans, per repo convention (#1387 carried the phase-3 design doc + plan).

## Verified Ground Truth (prod, 2026-07-15)

Live `ioniq/parsed/tpms` payload from prod mongo (`db.ioniq.find({topic:"ioniq/parsed/tpms"})`), verbatim:

```json
{"_type":"ioniq","group":"tpms","state":"active","ts":1784140447039,"seq":11057,
 "boot_id":"2b68df09-135e-43df-be6e-da17127c9725",
 "fl":{"psi":37,"c":37},"fr":{"psi":35.4,"c":38},"rr":{"psi":36.2,"c":38},"rl":{"psi":35.8,"c":38},
 "raw":"62C00BFFFF0000B9570100B1580100B5580100B3580100","hdr":"7A0","req":"22C00B",
 "_tz":1784140447137,"_ts":"2026-07-15T18:34:07.137Z"}
```

Note the payload carries its own top-level `raw` **string** key (the OBD hex frame) — unrelated to the bot's internal `raw` fingerprint variable. Do not confuse them.

Prod confirms zero tire output all-time:
`SHOW TAG VALUES FROM "ioniq" WITH KEY="group"` lists `derived/aux12v_drop`, `derived/cell_spread_mv`, `derived/dtc_count`, `derived/ldc_ok`, `derived/module_temp_spread_c` — and **no** `derived/tire_*`.

## File Structure

- `docker/automations/bots/ioniq-tpms.js` — the bot. Gains one `wheelOf` helper; handler reads `raw` instead of `payload` for per-wheel values. ~8 lines changed.
- `docker/automations/bots/ioniq-tpms.test.js` — fixtures converted flat → nested; one new verbatim-prod-payload regression test.

---

### Task 1: Convert test fixtures to the real nested shape (RED)

**Files:**
- Modify: `docker/automations/bots/ioniq-tpms.test.js:31-43` (the `sample()` factory)
- Modify: `docker/automations/bots/ioniq-tpms.test.js:103-109, 134-145, 148-208` (override call sites)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `sample(overrides)` returning the nested payload shape `{_type, group, state, ts, fl:{psi,c}, fr:{psi,c}, rl:{psi,c}, rr:{psi,c}}`. Task 2's implementation must satisfy these tests.

**Why the numbers stay the same:** the existing fixture values (36.6/35, 35.2/36, 35.6/37, 36.2/37) are kept, only re-nested. Every arithmetic assertion and its comment therefore remains valid, so a reviewer can see the fixtures changed shape and nothing else.

- [ ] **Step 1: Rewrite the `sample()` factory to nest each wheel**

Replace the factory at `ioniq-tpms.test.js:31-43` with:

```javascript
// Realistic prod-derived sample (2026-07-15 routy). The real tpms frame nests each
// wheel: {"fl":{"psi":37,"c":37}, ...}. Cold-normalize to 15 °C @ 0.18 psi/°C.
// fl: 36.6 - 0.18*(35-15) = 33.0 ; fr: 35.2 - 0.18*(36-15) = 31.42
// rl: 35.6 - 0.18*(37-15) = 31.64 ; rr: 36.2 - 0.18*(37-15) = 32.24
function sample (overrides = {}) {
  return {
    _type: 'ioniq',
    group: 'tpms',
    state: 'active',
    ts: 1000,
    fl: { psi: 36.6, c: 35 },
    fr: { psi: 35.2, c: 36 },
    rl: { psi: 35.6, c: 37 },
    rr: { psi: 36.2, c: 37 },
    ...overrides
  }
}
```

- [ ] **Step 2: Convert every partial-payload override to the nested shape**

Overrides replace a whole wheel object, so a "missing psi" wheel keeps its `c` and vice versa. Apply these exact edits:

`ioniq-tpms.test.js:103-109` — ambient fallback:
```javascript
  it('falls back to ambient temp when a wheel temp is missing', async () => {
    await mqtt._trigger(AMBIENT, { c: 25 })
    await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
    // fl uses ambient 25: 36.6 - 0.18*(25-15) = 36.6 - 1.8 = 34.8
    expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(34.8)
    expect(published(mqtt, 'tire_fl_psi_cold').temp).toBe(25)
  })
```

`ioniq-tpms.test.js:127-132` — re-emit on change:
```javascript
    it('re-emits when any reading changes', async () => {
      await mqtt._trigger(TPMS, sample({ ts: 1 }))
      const after = mqtt.publish.mock.calls.length
      await mqtt._trigger(TPMS, sample({ ts: 2, fl: { psi: 30.0, c: 35 } }))
      expect(mqtt.publish.mock.calls.length).toBeGreaterThan(after)
    })
```

`ioniq-tpms.test.js:134-145` — the pre-seeded `lastRaw` keeps its **flat** keys, because the bot's internal fingerprint is deliberately still flat (see Global Constraints). Leave that `raw` literal exactly as-is; it is not a payload.

`ioniq-tpms.test.js:148-208` — partial payloads:
```javascript
  describe('partial payloads', () => {
    it('omits a wheel with missing psi but still emits the others', async () => {
      await mqtt._trigger(TPMS, sample({ fl: { c: 35 } }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
    })

    it('excludes a psi-less wheel from spread', async () => {
      await mqtt._trigger(TPMS, sample({ fl: { c: 35 } }))
      // remaining cold: fr 31.42, rl 31.64, rr 32.24 → spread 32.24-31.42 = 0.82
      expect(published(mqtt, 'tire_spread_psi').value).toBe(0.82)
    })

    it('still counts a psi-less-but-temp-present wheel in others temp_excess', async () => {
      // fl has temp 35 but no psi. fr temp_excess still uses fl's temp in the mean.
      await mqtt._trigger(TPMS, sample({ fl: { c: 35 } }))
      expect(published(mqtt, 'tire_fr_temp_excess').value).toBe(-0.33)
    })

    it('emits no psi_cold for a wheel missing both its temp and any ambient', async () => {
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
    })

    it('does not emit spread when fewer than two wheels are valid', async () => {
      await mqtt._trigger(TPMS, sample({
        fr: { c: 36 }, rl: { c: 37 }, rr: { c: 37 }
      }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_spread_psi')).toBeUndefined()
    })

    it('does not emit temp_excess for a lone-temp wheel', async () => {
      await mqtt._trigger(TPMS, sample({
        fr: {}, rl: {}, rr: {}
      }))
      expect(publishedTopics(mqtt)).not.toContain(P('tire_fl_temp_excess'))
    })

    it('does not emit temp_excess for a wheel using only ambient fallback temp', async () => {
      await mqtt._trigger(AMBIENT, { c: 25 })
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      // fl still gets a cold pressure (via ambient) but no temp_excess (no own temp)
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeDefined()
      expect(published(mqtt, 'tire_fl_temp_excess')).toBeUndefined()
    })

    it('excludes an ambient-fallback wheel from the others temp_excess mean', async () => {
      await mqtt._trigger(AMBIENT, { c: 25 })
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      // fr excess uses only fr,rl,rr real temps: 36 - mean(37,37) = 36 - 37 = -1
      expect(published(mqtt, 'tire_fr_temp_excess').value).toBe(-1)
    })

    it('ignores a non-finite ambient temp', async () => {
      await mqtt._trigger(AMBIENT, { c: 'n/a' })
      await mqtt._trigger(TPMS, sample({ fl: { psi: 36.6 } }))
      // no valid temp for fl → no psi_cold
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
    })

    it('tolerates a wheel key that is absent entirely', async () => {
      await mqtt._trigger(TPMS, sample({ fl: undefined }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
    })

    it('tolerates a wheel value that is not an object', async () => {
      await mqtt._trigger(TPMS, sample({ fl: 'n/a' }))
      expect(published(mqtt, 'tire_fl_psi_cold')).toBeUndefined()
      expect(published(mqtt, 'tire_fr_psi_cold')).toBeDefined()
    })
  })
```

- [ ] **Step 3: Add a verbatim-prod-payload regression test**

This is the test that would have caught the bug. Append inside the top-level `describe('ioniq-tpms bot', ...)`, after the `partial payloads` describe block:

```javascript
  // Regression: the bot originally read flat `payload['fl.psi']` while the real
  // frame nests each wheel, so it never published anything. This fixture is a
  // verbatim prod payload (routy, 2026-07-15) — keep it byte-faithful.
  describe('real prod payload', () => {
    const PROD = {
      _type: 'ioniq',
      group: 'tpms',
      state: 'active',
      ts: 1784140447039,
      seq: 11057,
      boot_id: '2b68df09-135e-43df-be6e-da17127c9725',
      fl: { psi: 37, c: 37 },
      fr: { psi: 35.4, c: 38 },
      rr: { psi: 36.2, c: 38 },
      rl: { psi: 35.8, c: 38 },
      raw: '62C00BFFFF0000B9570100B1580100B5580100B3580100',
      hdr: '7A0',
      req: '22C00B',
      _tz: 1784140447137,
      _ts: '2026-07-15T18:34:07.137Z'
    }

    it('emits all four cold pressures from a verbatim prod frame', async () => {
      await mqtt._trigger(TPMS, PROD)
      // fl: 37 - 0.18*(37-15) = 33.04 ; fr: 35.4 - 0.18*(38-15) = 31.26
      // rl: 35.8 - 0.18*(38-15) = 31.66 ; rr: 36.2 - 0.18*(38-15) = 32.06
      expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(33.04)
      expect(published(mqtt, 'tire_fr_psi_cold').value).toBe(31.26)
      expect(published(mqtt, 'tire_rl_psi_cold').value).toBe(31.66)
      expect(published(mqtt, 'tire_rr_psi_cold').value).toBe(32.06)
    })

    it('emits spread and temp_excess from a verbatim prod frame', async () => {
      await mqtt._trigger(TPMS, PROD)
      // max 33.04 (fl) - min 31.26 (fr) = 1.78
      expect(published(mqtt, 'tire_spread_psi').value).toBe(1.78)
      // fl: 37 - mean(38,38,38) = -1
      expect(published(mqtt, 'tire_fl_temp_excess').value).toBe(-1)
    })

    it('does not mistake the payload hex `raw` string for wheel data', async () => {
      await mqtt._trigger(TPMS, PROD)
      expect(published(mqtt, 'tire_fl_psi_cold').psi).toBe(37)
    })
  })
```

- [ ] **Step 4: Run the tests and verify they FAIL (RED)**

Run: `cd docker/automations && npx jest bots/ioniq-tpms.test.js`

Expected: FAIL. The nested fixtures starve the flat reads, so `published(...)` returns `undefined` and assertions like `expect(published(mqtt, 'tire_fl_psi_cold').value).toBe(33.0)` throw `TypeError: Cannot read properties of undefined (reading 'value')`. **This failure is the bug reproducing in a test — record the output as evidence.** Only the `subscribes to...`, `active-only gating`, and `holds dedupe across restart` tests (which assert *absence* of publishes) should still pass.

- [ ] **Step 5: Commit the failing tests**

```bash
git add docker/automations/bots/ioniq-tpms.test.js
git commit -m "test(ioniq): reproduce tpms nested-payload bug with real frame shape"
```

---

### Task 2: Read the nested payload (GREEN)

**Files:**
- Modify: `docker/automations/bots/ioniq-tpms.js:14-19` (helper), `:52-95` (handler)
- Test: `docker/automations/bots/ioniq-tpms.test.js` (from Task 1, unchanged here)

**Interfaces:**
- Consumes: `sample()`/`PROD` nested fixtures from Task 1.
- Produces: no API change. `createIoniqTpms(name, config)` keeps its signature and all published topics/payload keys.

**The change in one sentence:** build the internal `raw` fingerprint from the nested payload via a `wheelOf` helper, then read per-wheel values from `raw` instead of `payload`.

- [ ] **Step 1: Add the `wheelOf` helper**

After `const round2 = ...` at `ioniq-tpms.js:19`, add:

```javascript
// The tpms frame nests each wheel: {"fl":{"psi":37,"c":37}, ...}. (The flat
// "fl.psi" fields visible in InfluxDB are produced by the mqtt-influx converter
// flattening at write time — they are not what this bot receives.) Returns an
// empty object for a missing or non-object wheel so callers can destructure.
const wheelOf = (payload, w) => {
  const v = payload[w]
  return (v && typeof v === 'object') ? v : {}
}
```

- [ ] **Step 2: Build the `raw` fingerprint from the nested payload**

Replace the extraction block at `ioniq-tpms.js:55-60`:

```javascript
        // Extract the raw wheel tuple in a fixed key order for stable dedupe.
        // Keys stay flat ("fl.psi") purely as an internal fingerprint shape.
        const raw = {}
        for (const w of WHEELS) {
          const { psi, c } = wheelOf(payload, w)
          raw[`${w}.psi`] = psi
          raw[`${w}.c`] = c
        }
```

- [ ] **Step 3: Read per-wheel values from `raw` instead of `payload`**

In the per-wheel resolve loop (`ioniq-tpms.js:77-87`), change the two reads:

```javascript
        for (const w of WHEELS) {
          const wt = raw[`${w}.c`]
          if (isFiniteNum(wt)) ownTemp[w] = wt
          const t = isFiniteNum(wt) ? wt : (isFiniteNum(ambientC) ? ambientC : null)
          if (t !== null) compTemp[w] = t

          const psi = raw[`${w}.psi`]
          if (isFiniteNum(psi) && t !== null) {
            cold[w] = psi - TEMP_COEFF * (t - REF_TEMP_C)
          }
        }
```

And in the cold-pressure publish loop (`ioniq-tpms.js:90-95`), change the `psi` extra:

```javascript
        for (const w of WHEELS) {
          if (cold[w] === undefined) continue
          publish(`tire_${w}_psi_cold`, payload, cold[w], {
            psi: raw[`${w}.psi`], temp: compTemp[w]
          })
        }
```

`publish(signal, base, ...)` still takes `payload` as `base` — `base.state` and `base.ts` are top-level and correct. Leave them.

- [ ] **Step 4: Note the nesting in the file header comment**

Append to the header comment block at `ioniq-tpms.js:1-11`:

```javascript
// The frame nests per-wheel values (payload.fl.psi); this bot normalizes them to
// an internal flat tuple for dedupe before deriving.
```

- [ ] **Step 5: Run the tests and verify they PASS (GREEN)**

Run: `cd docker/automations && npx jest bots/ioniq-tpms.test.js`
Expected: PASS, all tests green (including the three `real prod payload` tests).

- [ ] **Step 6: Run the full automations suite for regressions**

Run: `cd docker/automations && npm test`
Expected: PASS, no new failures vs. the pre-change baseline. If any unrelated test was already failing on the branch, capture that baseline first and confirm the set is unchanged.

- [ ] **Step 7: Commit**

```bash
git add docker/automations/bots/ioniq-tpms.js
git commit -m "fix(ioniq): read nested tpms payload so derived/tire_* actually emits"
```

---

### Task 3: Carry the phase-4 spec + plans, open the PR

**Files:**
- Already committed on the branch: `docs/superpowers/specs/2026-07-15-ioniq-monitoring-phase4-dashboards-design.md`
- Add: `docs/superpowers/plans/2026-07-15-ioniq-tpms-nested-payload-fix.md` (this plan)

**Interfaces:**
- Consumes: Tasks 1–2 commits.
- Produces: an OPEN PR carrying a verdict.

- [ ] **Step 1: Stage the plan (selective staging only)**

```bash
git add docs/superpowers/plans/2026-07-15-ioniq-tpms-nested-payload-fix.md
git commit -m "docs(ioniq): phase-4 tpms bugfix plan"
```

- [ ] **Step 2: Push and open the PR**

Branch `fix/ioniq-tpms-nested-payload`, cut **from** `docs/ioniq-phase4-dashboards-spec`, targeting **`master`**. The PR therefore carries the phase-4 spec + this plan + the fix as one self-contained merge — matching repo convention (#1387 carried the phase-3 design doc + plan) and ensuring the unmerged spec lands rather than being orphaned. Do **not** base the PR on the spec branch: that would merge into the spec branch and leave the spec itself unlanded.

```bash
git push -u origin fix/ioniq-tpms-nested-payload
gh pr create --base master \
  --title "fix(ioniq): tpms bot reads nested payload — restores derived/tire_* + dead tire alerts" \
  --body-file /path/to/pr-body.md
```

Write the body to a file first (avoids shell-quoting damage to the InfluxQL/JSON snippets). The body must state: the root cause (flat read vs. nested frame), the prod evidence (`derived/tire_*` count zero all-time; the verbatim payload above), why the original tests missed it (flat fixtures mirrored the bug), the fail-before/pass-after evidence, and that the spec + plan ride along per convention.

- [ ] **Step 3: Independent review gate**

Dispatch a **fresh** subagent (never the author) to review the branch diff against this plan and the spec §1.1. It must confirm: nested reads, nested fixtures, signal names unchanged, cache version justified, no scope creep. Address findings, then re-verify.

- [ ] **Step 4: Post-merge deploy + prod verification (human merges first)**

After the human merges, deploy per `ci-image-name-contract` (pull the automations image, `docker compose up -d --no-deps automations`), then confirm the signals land. **The car must drive/rotate wheels for tpms to refresh**, so absence immediately after deploy is not proof of failure — state that plainly rather than claiming success:

```
SHOW TAG VALUES FROM "ioniq" WITH KEY="group"      -- expect derived/tire_* to appear
SELECT count(value) FROM "ioniq" WHERE "group" =~ /^derived\/tire/ GROUP BY "group"
```
