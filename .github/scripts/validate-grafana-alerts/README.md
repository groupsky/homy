# validate-grafana-alerts

Rejects Grafana provisioning that loads cleanly and is wrong at run time:

1. Unsupported evaluator types in `config/grafana/provisioning/alerting/`.
2. Self-rescaling units on panels in `config/grafana/dashboards/`.
3. A Grafana version bump that would silently invalidate (2).

Every check always runs; a failure in one does not hide the state of another.

## Why — evaluator types

Grafana's `classic_conditions` accepts five evaluator types. `gte` and `lte` are
not among them, but the YAML provisioner accepts them without complaint: the
rule is created, appears healthy in the UI, and then fails to build an evaluator
on every scheduling tick. Combined with `execErrState: OK` the permanent error is
reported as Normal, so the rule is silently dead and nothing ever pages.

This has reached production twice — `boiler-solar-circulation-stuck` (`lte`,
issue #1472) and `boiler-controller-emergency-heating` (`gte`, issue #1475, dead
from the day it was written).

## Supported evaluator types

Derived from Grafana 9.5.21 source, and deliberately **not** one flat list:

| expression | source | accepts |
|---|---|---|
| `classic_conditions` | `pkg/expr/classic/classic.go` → `newAlertEvaluator` | `gt`, `lt`, `within_range`, `outside_range`, `no_value` |
| `threshold` | `pkg/expr/threshold.go` → `supportedThresholdFuncs` | `gt`, `lt`, `within_range`, `outside_range` |

`threshold` omits `no_value`. An evaluator with no resolvable enclosing model
type is checked against the `classic_conditions` set.

Rewrites: on an integer count `gte N` is `gt N-1` and `lte N` is `lt N+1`.

## How the evaluator check works

It **parses** each file and walks the resulting tree, treating any object with an
`evaluator` key as an evaluator host. It does not scan lines with regexes.

The first version of this check did scan lines, and was defeated by four
spellings of the same rule — all valid YAML that Grafana provisions, each making
it report `0 evaluator(s)` and exit 0:

| | bypass |
|---|---|
| S1 | `- {evaluator: {type: gte, ...}}` — a `{` rather than whitespace before the key |
| S2 | two evaluators on one line — the good one hid the bad one |
| S4 | the rule written as `.json`, which Grafana provisions and the scanner skipped |
| S5 | `- "evaluator":` — a quoted key |

Walking the parsed tree removes that class rather than adding a regex branch per
bypass. Every one of them is a test fixture in `tests/`.

It **fails closed**: an evaluator that cannot be resolved to
`evaluator: { type: <string> }` — missing `type`, non-string `type`, evaluator
that is a scalar or a sequence — fails the run, as does a file that cannot be
parsed, a missing directory and a directory with no provisioning files.

Handled because the parser resolves them: anchors, aliases, merge keys (`<<:`),
multi-document YAML, CRLF, and self-referential anchors (cycle-guarded).
Comments are invisible to it. Types are compared case-sensitively, as Grafana
compares them, so `GTE` is rejected too.

## Why — dashboard units

A Grafana unit built with `SIPrefix` is a thousand-based scale in both
directions. Below 1 the exponent goes negative, the value is multiplied by 1000
and the suffix picks up a smaller prefix, so `pressurebar` renders 0.80 as
`800.00 mbar`. The four raw tyre tiles on `Ioniq EV / Overview` did exactly that
for a flat tyre — in red, correctly, and in a different unit from the alert
text and the three healthy tiles beside it (issue #1481).

`SI_SCALING_UNITS` in `src/lib/units.ts` is every `SIPrefix(...)` unit in
`packages/grafana-data/src/valueFormats/categories.ts` as shipped in
`ghcr.io/groupsky/homy/grafana:9.5.21`, read out of the source maps in that
image's own `public/build`.

That list is data about one image, so the pin is checked rather than merely
documented: `runGrafanaVersionPin()` compares `DERIVED_FROM_GRAFANA` against the
`FROM ghcr.io/groupsky/homy/grafana:<tag>` line in `docker/grafana/Dockerfile` -
which is where the version actually lives, since `docker-compose.yml` refers to
the *built* image as `${IMAGE_TAG:-latest}`. A bump fails the run with the
commands for re-deriving the list and `tests/lib/grafana-value-format.ts` from
the new image.

Every panel that keeps such a unit must appear in `SI_UNIT_EXCEPTIONS` with a
reason saying why the series cannot go below 1, or why the smaller prefix reads
correctly there. The check also fails on an exception that no longer matches any
panel, so the registry cannot rot into a blanket approval.

One thing is **not** delegated to a written reason: a panel whose own
`thresholds` include a step below 1 *in magnitude* cannot be excused at all. A
threshold is written in the base unit, so a step at `0.1` is the dashboard
saying the series lives exactly where the formatter switches. Sign is
irrelevant - `scaledUnits` scales on `Math.abs(size)`, so a mower's charging
current at `-0.5 A` renders `-500.00 mA` and is the same pathology. Exactly `0`
is not, because `size === 0` is special-cased to the base unit. Five panels were excused that way in
the first draft of this check — two `12 V Sag` tiles with a 0.1 V threshold, two
mower current panels with 5 A / 10 A thresholds and an idle current below 1 A,
and the heat-pump `Power` panel — with a reason that claimed no threshold on the
panel was in the base unit. It was false. Those panels now use a fixed suffix,
and the rule exists so the same mistake cannot be made in prose again.

`tests/lib/grafana-value-format.ts` transcribes the deployed formatter itself,
so the claim above is a test that runs rather than a screenshot to trust. It
reproduces the three values quoted in issue #1481 exactly.

### How the unit check reads a dashboard

Both spellings Grafana uses, since a check that saw one of them would pass files
it never really looked at:

| | where |
|---|---|
| panel-wide | `fieldConfig.defaults.unit: "volt"` |
| per series | `fieldConfig.overrides[].properties[]` → `{ id: "unit", value: "volt" }` |
| legacy axis | `yaxes[].format: "watt"` on an angular `graph` panel |

Six of the twelve dashboards here use overrides, several setting a unit that
appears nowhere else in the file; `reminders.json` still has four legacy axis
formats. `format` is read only inside a `yaxes` array — elsewhere in a dashboard
it means something else entirely (`"format": "time_series"` on an InfluxDB
target). Nested row panels are walked, and dashboards in subdirectories
(`Ioniq EV/…`) are provisioned and therefore checked.

Unit ids are matched by `isSelfRescaling()`, which also covers Grafana's dynamic
`si: <unit>` spelling — `"unit": "si: bar"` builds the same `SIPrefix` formatter
as `pressurebar` and would slip past an exact-id lookup.

It **fails closed** the same way: a `unit` that is not a string, or that cannot
be attributed to a panel with a numeric `id`, fails the run.

## Usage

```bash
npm ci
npm test          # unit + integration tests
npm run validate  # check the repository's alert rules
npm run typecheck
```

`npm run validate` resolves the alerting and dashboard directories from this
package's own location, so it works from any working directory. The path is a constant on
purpose: taking it from `argv` or the environment would make every file read a
path-injection sink (CodeQL `js/path-injection`) for no benefit.

## CI

`.github/workflows/validate-grafana-alerts.yml`, path-filtered on the alerting
directory, the dashboards directory, this package, and the workflow itself.

**It is not a required status check on `master`** — the ruleset requires only
`CodeQL` and `Workflow Summary`, so a red result reports but does not block
merge. Adding `Validate Alert Evaluators and Dashboard Units` to the branch
ruleset is a repo-admin change and has not been made here.
