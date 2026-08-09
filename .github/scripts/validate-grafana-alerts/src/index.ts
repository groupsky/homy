#!/usr/bin/env node
/**
 * Rejects unsupported evaluator types in provisioned Grafana alert rules.
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
 * Run with `npm run validate` from this directory, or via
 * `.github/workflows/validate-grafana-alerts.yml`.
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { run } from './lib/report.js';

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

const result = run(ALERTING_DIR);
for (const line of result.out) console.log(line);
for (const line of result.err) console.error(line);
process.exit(result.code);
