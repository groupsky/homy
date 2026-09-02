#!/usr/bin/env node
/**
 * Rejects Grafana provisioning that is accepted at load time and wrong at run
 * time. Two checks, both of failures that leave the UI looking healthy.
 *
 * 1. Unsupported evaluator types in provisioned alert rules.
 *
 * Grafana's `classic_conditions` knows five evaluators: gt, lt, within_range,
 * outside_range and no_value. Anything else - `gte` and `lte` above all, which
 * look plausible and which the YAML provisioner accepts without complaint -
 * makes the scheduler log "Failed to build rule evaluator ... invalid evaluator
 * type" on every tick. The rule never evaluates its query, and with
 * `execErrState: OK` it reports Normal, so it is silently dead with nothing
 * visible in the UI.
 *
 * That has happened twice: `boiler-solar-circulation-stuck` (`lte`, issue
 * #1472) and `boiler-controller-emergency-heating` (`gte`, issue #1475 - dead
 * from the day it was written). This check exists so it cannot happen again.
 *
 * 2. Self-rescaling units on dashboard panels.
 *
 * Grafana's SIPrefix units are not fixed suffixes: below 1 they multiply the
 * value by 1000 and change the suffix, so a tyre-pressure tile in
 * `pressurebar` renders a flat tyre as `800.00 mbar` next to three siblings
 * and an alert that all say bar (issue #1481). Every panel using such a unit
 * must be listed in `SI_UNIT_EXCEPTIONS` with a reason.
 *
 * 3. A Grafana bump that silently invalidates (2).
 *
 * The unit list in `src/lib/units.ts` is data read out of one image's source
 * maps. `docker/grafana/Dockerfile` is where the version is pinned, so the two
 * are compared and a mismatch fails with instructions for re-deriving the list.
 *
 * Run with `npm run validate` from this directory, or via
 * `.github/workflows/validate-grafana-alerts.yml`.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { run } from './lib/report.js';
import { runDashboardUnits } from './lib/unit-report.js';
import { runGrafanaVersionPin } from './lib/grafana-version.js';

/**
 * Fixed on purpose. Taking the directory from argv or the environment would
 * make every file read here a path-injection sink (CodeQL js/path-injection)
 * for no benefit - there is exactly one alerting provisioning directory.
 *
 * Derived from this module's own location rather than `process.cwd()` so the
 * tool works whether it is run from the repository root or from this package.
 * `src/index.ts` sits four levels below the repository root.
 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ALERTING_DIR = path.join(REPO_ROOT, 'config/grafana/provisioning/alerting');
const DASHBOARD_DIR = path.join(REPO_ROOT, 'config/grafana/dashboards');
const GRAFANA_DOCKERFILE = path.join(REPO_ROOT, 'docker/grafana/Dockerfile');

// Every check always runs: a failure in one must not hide the state of another.
const results = [run(ALERTING_DIR), runDashboardUnits(DASHBOARD_DIR), runGrafanaVersionPin(GRAFANA_DOCKERFILE)];
for (const result of results) {
  for (const line of result.out) console.log(line);
  for (const line of result.err) console.error(line);
  console.log('');
}
process.exit(results.some((result) => result.code !== 0) ? 1 : 0);
