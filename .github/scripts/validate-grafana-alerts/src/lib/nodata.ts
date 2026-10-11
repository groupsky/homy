import { existsSync, readFileSync } from 'fs';
import { loadAll } from 'js-yaml';
import type { RunResult } from './report.js';
import { listProvisioningFiles } from './scan.js';

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/** A provisioned rule whose no-data state Grafana resolves to `NoData`. */
export interface NoDataRule {
  file: string;
  uid: string;
  /** The value as written, or `(missing)` when the key is absent. */
  value: string;
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Rules in one parsed document that end up with `noDataState: NoData`.
 *
 * Grafana 9.5.21, `pkg/services/provisioning/alerting/rules_types.go`: a
 * missing or blank `noDataState` defaults to `NoData`, so those count too.
 */
export function noDataRules (document: unknown, file: string): NoDataRule[] {
  if (!isRecord(document) || !Array.isArray(document.groups)) return [];
  const found: NoDataRule[] = [];
  for (const group of document.groups) {
    if (!isRecord(group) || !Array.isArray(group.rules)) continue;
    for (const rule of group.rules) {
      if (!isRecord(rule)) continue;
      const raw = rule.noDataState;
      const value = typeof raw === 'string' ? raw.trim() : '';
      if (value === '' || value === 'NoData') {
        found.push({ file, uid: typeof rule.uid === 'string' ? rule.uid : '(rule has no uid)', value: raw === undefined ? '(missing)' : String(raw) });
      }
    }
  }
  return found;
}

/**
 * Fails when any provisioned alert rule uses `noDataState: NoData`.
 *
 * Grafana 9.5 sends the NoData state at once, as a `DatasourceNoData` alert
 * ("DATA SOURCE ISSUE" in Telegram), without waiting for `for`. So a short gap
 * in InfluxDB data, for example while a writer restarts, pages at once
 * (#1682, #1695). `Alerting` waits for `for`; `OK` treats no data as healthy.
 */
export function runNoDataState (dir: string): RunResult {
  const out: string[] = [];
  const err: string[] = [];

  if (!existsSync(dir)) {
    err.push(`❌ Alert provisioning directory not found: ${dir}`);
    return { code: 1, out, err };
  }

  const found: NoDataRule[] = [];
  for (const file of listProvisioningFiles(dir)) {
    let documents: unknown[];
    try {
      documents = loadAll(readFileSync(file, 'utf8'));
    } catch {
      // The evaluator check already reports a file that cannot be parsed.
      continue;
    }
    for (const document of documents) found.push(...noDataRules(document, file));
  }

  if (found.length === 0) {
    out.push('✅ No provisioned alert rule uses noDataState: NoData.');
    return { code: 0, out, err };
  }

  err.push(RULE, `❌ ${found.length} alert rule(s) use noDataState: NoData (or leave it unset).`, '');
  for (const rule of found) {
    err.push(`  ${rule.file}`, `    rule uid    : ${rule.uid}`, `    noDataState : ${rule.value}`, '');
  }
  err.push(
    'Grafana 9.5 sends NoData at once as a "DATA SOURCE ISSUE" page and does',
    'not wait for `for`, so a short writer gap pages (#1682, #1695).',
    'Use `Alerting` when no data is the problem (it waits for `for`), or `OK`',
    'when no data means nothing to report. Add a short comment with the reason.',
    RULE
  );
  return { code: 1, out, err };
}
