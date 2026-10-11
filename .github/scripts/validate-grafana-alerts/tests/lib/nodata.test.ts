import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { runNoDataState } from '../../src/lib/nodata.js';

/** The repository's real alerting directory, four levels above this package. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const REAL_ALERTING_DIR = path.join(REPO_ROOT, 'config/grafana/provisioning/alerting');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'alerting-nodata-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** A one-rule provisioning file; `state` is the raw `noDataState` line or null to omit it. */
function ruleFile (uid: string, state: string | null): string {
  return `apiVersion: 1
groups:
  - orgId: 1
    name: G
    folder: F
    interval: 1m
    rules:
      - uid: ${uid}
        title: T
        condition: A
${state === null ? '' : `        ${state}\n`}        execErrState: OK
`;
}

describe('runNoDataState', () => {
  it('passes rules with Alerting or OK', () => {
    writeFileSync(path.join(dir, 'a.yaml'), ruleFile('alerting-rule', 'noDataState: Alerting'));
    writeFileSync(path.join(dir, 'b.yaml'), ruleFile('ok-rule', 'noDataState: OK'));
    const result = runNoDataState(dir);
    expect(result.code).toBe(0);
    expect(result.err).toEqual([]);
  });

  it('fails a rule with noDataState: NoData and names it', () => {
    writeFileSync(path.join(dir, 'a.yaml'), ruleFile('ok-rule', 'noDataState: OK'));
    writeFileSync(path.join(dir, 'b.yaml'), ruleFile('nodata-rule', 'noDataState: NoData'));
    const result = runNoDataState(dir);
    expect(result.code).toBe(1);
    const text = result.err.join('\n');
    expect(text).toContain('nodata-rule');
    expect(text).not.toContain('ok-rule');
  });

  it('fails a rule with no noDataState, because Grafana defaults it to NoData', () => {
    writeFileSync(path.join(dir, 'a.yaml'), ruleFile('unset-rule', null));
    const result = runNoDataState(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('unset-rule');
  });

  it('fails a rule written as .json', () => {
    writeFileSync(
      path.join(dir, 'a.json'),
      JSON.stringify({ groups: [{ rules: [{ uid: 'json-rule', noDataState: 'NoData' }] }] })
    );
    expect(runNoDataState(dir).code).toBe(1);
  });

  it('ignores files with no rules, such as deleteRules', () => {
    writeFileSync(path.join(dir, 'a.yaml'), 'apiVersion: 1\ndeleteRules:\n  - orgId: 1\n    uid: old\n');
    expect(runNoDataState(dir).code).toBe(0);
  });

  it('passes the real provisioning directory', () => {
    const result = runNoDataState(REAL_ALERTING_DIR);
    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
  });
});
