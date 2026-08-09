import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { run } from '../../src/lib/report.js';

/** The repository's real alerting directory, four levels above this package. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const REAL_ALERTING_DIR = path.join(REPO_ROOT, 'config/grafana/provisioning/alerting');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'alerting-run-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write (name: string, content: string): void {
  writeFileSync(path.join(dir, name), content);
}

const GOOD_RULE = `apiVersion: 1
groups:
  - orgId: 1
    name: G
    folder: F
    interval: 1m
    rules:
      - uid: good-rule
        title: Good
        condition: A
        data:
          - refId: A
            datasourceUid: __expr__
            model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gt, params: [0] }
                  operator: { type: and }
                  reducer: { type: last }
                  type: query
        noDataState: OK
        execErrState: OK
`;

describe('run - exit codes', () => {
  it('passes a directory whose evaluators are all supported', () => {
    write('good.yaml', GOOD_RULE);
    const result = run(dir);
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain('All 1 evaluators use a type their expression supports.');
    expect(result.err).toEqual([]);
  });

  it('fails a directory containing gte, naming the file, uid and evaluator', () => {
    write('good.yaml', GOOD_RULE);
    write('bad.yaml', GOOD_RULE.replace('uid: good-rule', 'uid: bad-rule').replace('{ type: gt, params: [0] }', '{ type: gte, params: [1] }'));
    const result = run(dir);
    expect(result.code).toBe(1);
    const err = result.err.join('\n');
    expect(err).toContain('1 unsupported evaluator type(s) found.');
    expect(err).toContain(path.join(dir, 'bad.yaml'));
    expect(err).toContain('rule uid  : bad-rule');
    expect(err).toContain('type: gte');
    expect(err).toContain('`gte 1` on a count is `gt 0`');
    // The clean file is still reported as clean.
    expect(result.out.join('\n')).toContain('✅ ' + path.join(dir, 'good.yaml'));
  });

  it('fails a directory containing an unreadable evaluator', () => {
    write('broken.yaml', 'conditions:\n  - evaluator: { params: [1] }\n');
    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('could not be read - they are therefore unchecked');
  });

  it('fails when the directory does not exist', () => {
    const result = run(path.join(dir, 'nope'));
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('Alert provisioning directory not found');
  });

  it('fails when the directory holds no provisioning files', () => {
    write('README.md', '# nothing here\n');
    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('No provisioning files');
  });

  it('fails on a .json rule file, which Grafana provisions too', () => {
    write('good.yaml', GOOD_RULE);
    write('sneaky.json', JSON.stringify({ groups: [{ rules: [{ uid: 'json-rule', data: [{ model: { type: 'classic_conditions', conditions: [{ evaluator: { type: 'lte', params: [1] } }] } }] }] }] }));
    const result = run(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('rule uid  : json-rule');
  });
});

describe('run - against the repository as committed', () => {
  it('passes on config/grafana/provisioning/alerting', () => {
    const result = run(REAL_ALERTING_DIR);
    if (result.code !== 0) console.error(result.err.join('\n'));
    expect(result.code).toBe(0);
  });

  it('finds evaluators in the real rule files', () => {
    const result = run(REAL_ALERTING_DIR);
    const match = result.out.join('\n').match(/All (\d+) evaluators/);
    expect(match).not.toBeNull();
    expect(Number(match![1])).toBeGreaterThan(50);
  });
});
