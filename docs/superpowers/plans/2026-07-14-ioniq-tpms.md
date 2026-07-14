# Ioniq TPMS bot — implementation plan

Spec: [`../specs/2026-07-14-ioniq-tpms-design.md`](../specs/2026-07-14-ioniq-tpms-design.md)
Branch: `feat/ioniq-tpms` (worktree). TDD, red→green→refactor.

## Task 1 — TDD the bot (`ioniq-tpms.js` + `.test.js`)
1. Write `ioniq-tpms.test.js` first, mirroring `ioniq-dtc.test.js` mocked-MQTT pattern
   (`makeMqtt` with `_callbacks`/`_trigger`, `makeCache` returning `{ lastRaw: null }`). Cover every
   scenario in spec §8. Use realistic prod-derived vectors (fl.psi=36.6, fl.c=35 → psi_cold 33.0).
2. Run `npm ci` (fresh worktree) then `npx jest bots/ioniq-tpms.test.js` → RED (module missing).
3. Implement `ioniq-tpms.js`:
   - `module.exports = (name, config) => ({ persistedCache, start })`.
   - Config: `tpmsTopic`, `ambientTopic`, output topic prefix `ioniq/parsed/derived/`, all overridable.
   - `persistedCache`: `{ version:1, default:{ lastRaw:null } }`.
   - `start({ mqtt, persistedCache })`: subscribe ambient (cache `ambient.c`), subscribe tpms (evaluate).
   - Helpers: `finite(x)` guard, `round2(x)`, `coldPsi(psi,temp)`, per-wheel extraction of dotted keys.
   - Gate on `state==='active'`; dedupe via stable-stringify of raw tuple vs `lastRaw`.
   - Emit the 4 psi_cold, spread, 4 temp_excess signals per spec §4.3.
4. Run tests → GREEN. Refactor for clarity; keep comments explaining *why* (dedupe, gating).
5. **Review gate (fresh subagent):** per-task review of bot + tests.

## Task 2 — Register bot in `config/automations/config.js`
Append an `ioniqTpms` block near `ioniqDtc` (~line 486). Selective edit, no reformatting.
```js
ioniqTpms: {
  type: 'ioniq-tpms',
  tpmsTopic: 'ioniq/parsed/tpms',
  ambientTopic: 'ioniq/parsed/ambient',
},
```

## Task 3 — Grafana rules `config/grafana/provisioning/alerting/ioniq-tpms-alerts.yaml`
17 rules per spec §6, cloning `ioniq-12v-alerts.yaml` structure. Mechanical transcription (haiku-suitable)
but generated carefully and validated with a YAML parse.

## Task 4 — Doc `docs/influxdb-schema.md`
Add the new `derived/tire_*` groups under the `ioniq` measurement `group` bullet, following the
`derived/dtc_count` precedent (name each group, its `value` meaning, and the Grafana rule that consumes it).

## Task 5 — Verification & review
1. `npx jest bots/ioniq-tpms.test.js` green; full `npm test` sanity (no regressions).
2. Node syntax check of config.js; YAML parse of the alerts file.
3. **Whole-branch review (fresh subagent)** before PR.
4. Commit (selective staging, `Claude-Session` trailer), push, `gh pr create`.
5. **Fresh PR review** after opening.

## Review gates (never self-review)
- Spec review (done before impl).
- Plan review (done before impl).
- Task-1 per-task review.
- Whole-branch review.
- Fresh PR review.
Escalate to human only for a genuine product/judgment call.
