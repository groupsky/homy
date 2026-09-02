import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { grafanaBaseTag, runGrafanaVersionPin } from '../../src/lib/grafana-version.js';
import { DERIVED_FROM_GRAFANA } from '../../src/lib/units.js';

/** The repository's real Grafana Dockerfile, four levels above this package. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const REAL_DOCKERFILE = path.join(REPO_ROOT, 'docker/grafana/Dockerfile');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'grafana-pin-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function dockerfile (content: string): string {
  const file = path.join(dir, 'Dockerfile');
  writeFileSync(file, content);
  return file;
}

describe('grafanaBaseTag', () => {
  it('reads the tag off the FROM line', () => {
    expect(grafanaBaseTag(dockerfile('FROM ghcr.io/groupsky/homy/grafana:9.5.21\n\nUSER root\n'))).toBe('9.5.21');
  });

  it('ignores an unrelated FROM', () => {
    expect(grafanaBaseTag(dockerfile('FROM ghcr.io/groupsky/homy/node:18.20.8-alpine\n'))).toBeNull();
  });

  it('finds the line among later build stages', () => {
    expect(grafanaBaseTag(dockerfile('# comment\nARG X=1\nFROM ghcr.io/groupsky/homy/grafana:10.0.0 AS base\n'))).toBe('10.0.0');
  });
});

describe('runGrafanaVersionPin', () => {
  it('passes the repository as it stands', () => {
    const result = runGrafanaVersionPin(REAL_DOCKERFILE);

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
    expect(result.out.join('\n')).toContain(DERIVED_FROM_GRAFANA);
  });

  it('agrees with the tag the real Dockerfile pins', () => {
    expect(grafanaBaseTag(REAL_DOCKERFILE)).toBe(DERIVED_FROM_GRAFANA);
  });

  it('fails on a version bump, naming both versions', () => {
    const result = runGrafanaVersionPin(dockerfile('FROM ghcr.io/groupsky/homy/grafana:10.4.2\n'));

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('bumped to 10.4.2');
    expect(result.err.join('\n')).toContain(DERIVED_FROM_GRAFANA);
  });

  it('tells the reader how to re-derive the list, for the new version', () => {
    const err = runGrafanaVersionPin(dockerfile('FROM ghcr.io/groupsky/homy/grafana:10.4.2\n')).err.join('\n');

    expect(err).toContain('Re-derive the list');
    expect(err).toContain('ghcr.io/groupsky/homy/grafana:10.4.2');
    expect(err).toContain('valueFormats/categories.ts');
    expect(err).toContain('grafana-value-format.ts');
  });

  it('fails when the Dockerfile pins no Grafana image at all', () => {
    const result = runGrafanaVersionPin(dockerfile('FROM ghcr.io/groupsky/homy/alpine:3.22.1\n'));

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('No `FROM ghcr.io/groupsky/homy/grafana:<tag>` line');
  });

  it('fails when the Dockerfile is missing', () => {
    const result = runGrafanaVersionPin(path.join(dir, 'nope'));

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('Grafana Dockerfile not found');
  });
});
