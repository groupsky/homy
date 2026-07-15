# Implementation Plan — `ioniq-cell-health` bot

Spec: [`../specs/2026-07-14-ioniq-cell-health-design.md`](../specs/2026-07-14-ioniq-cell-health-design.md)
· Contract: [`../specs/2026-07-14-ioniq-monitoring-phase3-design.md`](../specs/2026-07-14-ioniq-monitoring-phase3-design.md)
Branch: `feat/ioniq-cell-health` (isolated worktree)

## Preconditions (done)

- [x] Prod-verified all five topic strings live (`mosquitto_sub`) + field shapes (InfluxDB).
- [x] Spec + plan written; independent spec/plan review before coding.

## Task 1 — Bot (TDD, red → green → refactor)

1. Write `docker/automations/bots/ioniq-cell-health.test.js` first (fails: no module). Cover the 9
   scenarios in spec §7 using the mocked-MQTT pattern from `ioniq-dtc.test.js` (`makeMqtt` with
   `_callbacks`/`_trigger`, plain-object `persistedCache`).
2. Implement `docker/automations/bots/ioniq-cell-health.js`:
   - `module.exports = (name, config) => ({ persistedCache: { version:1, default:{…} }, start })`.
   - Config defaults per spec §4; `persistedCache.default` holds `cellSegments` (3 nullable arrays keyed
     by segment index 0/33/65 or a `{seg1,seg33,seg65}` object) + `moduleTemps`/`moduleTemps6_12`.
   - Helper `parseFloatArray(raw, expectedLen)` → array or `null` (JSON.parse guard, Array.isArray,
     length check, `Number.isFinite` on every element). Mirror `ioniq-dtc`'s `parseCodes` tolerance.
   - Cell handler: update segment, emit `cell_spread_mv` when all 3 present and `state !== 'active'`.
   - Temp handler: update segment, emit `module_temp_spread_c` when both present.
   - Outlier index: 1-based argmax of `|cell − mean|`, lowest index on tie.
3. Run `cd docker/automations && npm ci && npx jest bots/ioniq-cell-health.test.js` → green.
4. Independent per-task review (fresh subagent). Address findings.

## Task 2 — Register bot in `config/automations/config.js`

- Append `ioniqCellHealth` block immediately after the `ioniqDtc` block (~line 486). Selective edit,
  no reformatting.

## Task 3 — Grafana rules `config/grafana/provisioning/alerting/ioniq-cell-health-alerts.yaml`

- Clone `ioniq-12v-alerts.yaml`; four rules per spec §5. Validate YAML parses.

## Task 4 — `docs/influxdb-schema.md`

- Under the `ioniq` measurement `group` list, add `derived/cell_spread_mv` and
  `derived/module_temp_spread_c` bullets following the `derived/dtc_count` pattern (field `value` = the
  numeric signal; `cell_spread_mv` extra field `outlierIndex`).

## Task 5 — Whole-branch review + PR

- Fresh whole-branch review (opus). Address findings.
- Full test run `cd docker/automations && npm test` green; confirm no `MODULE_NOT_FOUND` for the new bot
  in the config load path (config registration resolves the type).
- Commit selectively (spec/plan; bot+test; config; grafana; schema) with `Claude-Session` trailer.
- Push, `gh pr create` (base master), title per orchestrator brief. Fresh PR review → verdict.

## Risks / notes

- `cells/*` frames are high-rate; emitting on every frame is acceptable (matches `dtc_count` cadence,
  Grafana reads `last`). Active-skip prevents driving-noise from polluting the rest-spread signal.
- Do not overwrite a good segment with a malformed one — retention is essential so a single bad frame
  can't zero the signal.
</content>
