# validate-grafana-alerts

Rejects unsupported evaluator types in `config/grafana/provisioning/alerting/`.

## Why

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

## How it checks

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

## Usage

```bash
npm ci
npm test          # unit + integration tests
npm run validate  # check the repository's alert rules
npm run typecheck
```

`npm run validate` resolves the alerting directory from this package's own
location, so it works from any working directory. The path is a constant on
purpose: taking it from `argv` or the environment would make every file read a
path-injection sink (CodeQL `js/path-injection`) for no benefit.

## CI

`.github/workflows/validate-grafana-alerts.yml`, path-filtered on the alerting
directory, this package, and the workflow itself.

**It is not a required status check on `master`** — the ruleset requires only
`CodeQL` and `Workflow Summary`, so a red result reports but does not block
merge. Adding `Validate Alert Evaluators` to the branch ruleset is a repo-admin
change and has not been made here.
