import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { listProvisioningFiles, PROVISIONED_EXTENSIONS, scanFile } from '../../src/lib/scan.js';
import { invalidFindings } from '../../src/lib/evaluators.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'alerting-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Writes `content` to `name` in the temp provisioning directory. */
function write (name: string, content: string): string {
  const file = path.join(dir, name);
  writeFileSync(file, content);
  return file;
}

describe('listProvisioningFiles', () => {
  it('lists every extension Grafana provisions', () => {
    // Grafana 9.5.21 pkg/services/provisioning/alerting/config_reader.go
    // accepts .yaml, .yml AND .json.
    expect(PROVISIONED_EXTENSIONS).toEqual(['.yaml', '.yml', '.json']);
    write('a.yaml', 'x: 1\n');
    write('b.yml', 'x: 1\n');
    write('c.json', '{"x":1}');
    expect(listProvisioningFiles(dir).map((f) => path.basename(f))).toEqual(['a.yaml', 'b.yml', 'c.json']);
  });

  it('ignores files Grafana would not provision', () => {
    write('rules.yaml', 'x: 1\n');
    write('README.md', '# notes\n');
    write('notes.txt', 'evaluator: {type: gte}\n');
    write('rules.yaml.bak', 'x: 1\n');
    expect(listProvisioningFiles(dir).map((f) => path.basename(f))).toEqual(['rules.yaml']);
  });

  it('matches extensions case-insensitively', () => {
    write('Rules.YAML', 'x: 1\n');
    expect(listProvisioningFiles(dir)).toHaveLength(1);
  });
});

describe('scanFile', () => {
  it('reads evaluators from a .json rule file', () => {
    const file = write(
      'rules.json',
      JSON.stringify({
        groups: [{ rules: [{ uid: 'json-rule', data: [{ model: { type: 'classic_conditions', conditions: [{ evaluator: { type: 'gte', params: [1] } }] } }] }] }],
      })
    );
    const bad = invalidFindings(scanFile(file).findings);
    expect(bad.map((f) => [f.uid, f.type])).toEqual([['json-rule', 'gte']]);
  });

  it('reads every document of a multi-document YAML file', () => {
    const file = write('multi.yaml', 'conditions:\n  - evaluator: {type: gt, params: [0]}\n---\nconditions:\n  - evaluator: {type: gte, params: [1]}\n');
    const { findings } = scanFile(file);
    expect(findings.map((f) => f.type)).toEqual(['gt', 'gte']);
    expect(findings[1].path).toBe('doc[1].conditions[0].evaluator');
    expect(invalidFindings(findings)).toHaveLength(1);
  });

  it('reads a file with CRLF line endings', () => {
    const file = write('crlf.yaml', 'conditions:\r\n  - evaluator:\r\n      params: [1]\r\n      type: gte\r\n');
    expect(invalidFindings(scanFile(file).findings).map((f) => f.type)).toEqual(['gte']);
  });

  it('reports an unparseable file instead of throwing', () => {
    const file = write('broken.yaml', 'groups:\n  - rules:\n   bad indentation:\n  \t- tab\n');
    const { findings, problems } = scanFile(file);
    expect(findings).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('cannot be parsed');
  });

  it('reports an unparseable .json file', () => {
    const file = write('broken.json', '{"groups": [');
    expect(scanFile(file).problems[0].message).toContain('cannot be parsed');
  });

  it('returns nothing for a file with no evaluators', () => {
    const file = write('contact-points.yaml', 'apiVersion: 1\ncontactPoints:\n  - name: telegram\n');
    expect(scanFile(file)).toEqual({ findings: [], problems: [] });
  });

  it('returns nothing for an empty file', () => {
    const file = write('empty.yaml', '');
    expect(scanFile(file)).toEqual({ findings: [], problems: [] });
  });
});
