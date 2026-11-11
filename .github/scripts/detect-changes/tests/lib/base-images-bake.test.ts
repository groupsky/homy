/**
 * docker-bake.hcl is the production source of truth for base images.
 *
 * Only `docker buildx bake --print` is mocked (Jest gives tests a copy of
 * process.env, so a fake `docker` on PATH would not be seen by execSync).
 * Directories and Dockerfiles are real files in a temp directory.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const execSync = jest.fn<(...args: unknown[]) => string>();
jest.unstable_mockModule('child_process', () => ({ execSync }));

const { discoverBaseImages, getTargetsFromDockerBake } = await import('../../src/lib/base-images.js');

let baseDir: string;

const addImage = (name: string, content = `FROM ${name}:1.0\n`) => {
  fs.mkdirSync(path.join(baseDir, name), { recursive: true });
  fs.writeFileSync(path.join(baseDir, name, 'Dockerfile'), content);
};

const bakeReturns = (targets: string[]) =>
  execSync.mockReturnValue(JSON.stringify({ group: { default: { targets } } }));

const bakeFails = (message: string) =>
  execSync.mockImplementation(() => {
    throw new Error(message);
  });

beforeEach(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-test-'));
  fs.writeFileSync(path.join(baseDir, 'docker-bake.hcl'), '# targets come from the mock\n');
  execSync.mockReset();
});

afterEach(() => {
  fs.rmSync(baseDir, { recursive: true, force: true });
});

describe('getTargetsFromDockerBake', () => {
  test('returns the sorted default group, run in the base-images directory', () => {
    bakeReturns(['grafana', 'alpine']);
    expect(getTargetsFromDockerBake(baseDir)).toEqual(['alpine', 'grafana']);
    expect(execSync).toHaveBeenCalledWith('docker buildx bake --print', expect.objectContaining({ cwd: baseDir }));
  });

  test('returns [] when there is no default group', () => {
    execSync.mockReturnValue('{}');
    expect(getTargetsFromDockerBake(baseDir)).toEqual([]);
  });

  test('explains a missing docker buildx', () => {
    bakeFails('/bin/sh: docker: command not found');
    expect(() => getTargetsFromDockerBake(baseDir)).toThrow(/Docker Buildx is required/);
  });

  test('explains a missing docker buildx on Windows', () => {
    bakeFails("'docker' is not recognized as an internal or external command");
    expect(() => getTargetsFromDockerBake(baseDir)).toThrow(/Docker Buildx is required/);
  });

  test('wraps any other failure', () => {
    bakeFails('ERROR: failed to find target default');
    expect(() => getTargetsFromDockerBake(baseDir)).toThrow(
      /Failed to parse docker-bake.hcl: ERROR: failed to find target default/
    );
  });

  test('wraps output that is not JSON', () => {
    execSync.mockReturnValue('not json');
    expect(() => getTargetsFromDockerBake(baseDir)).toThrow(/Failed to parse docker-bake.hcl/);
  });
});

describe('discoverBaseImages with docker-bake.hcl', () => {
  test('uses the bake targets when they match the directories', () => {
    addImage('alpine');
    addImage('grafana');
    bakeReturns(['grafana', 'alpine']);
    expect(discoverBaseImages(baseDir).map((r) => r.directory)).toEqual(['alpine', 'grafana']);
  });

  test('falls back to scanning directories when docker buildx fails', () => {
    addImage('alpine');
    bakeFails('ERROR: failed to find target default');
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(discoverBaseImages(baseDir).map((r) => r.directory)).toEqual(['alpine']);
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('falling back to directory scanning'));
    } finally {
      spy.mockRestore();
    }
  });

  test('rejects a directory that is not a bake target', () => {
    addImage('alpine');
    addImage('orphan');
    fs.mkdirSync(path.join(baseDir, 'docs'));
    bakeReturns(['alpine']);
    expect(() => discoverBaseImages(baseDir)).toThrow(/Orphaned base image directories found[^\n]*: orphan$/m);
  });

  test('rejects a bake target without a directory', () => {
    addImage('alpine');
    bakeReturns(['alpine', 'ghost']);
    expect(() => discoverBaseImages(baseDir)).toThrow(/Missing base image directories[^\n]*: ghost$/m);
  });

  test('rejects a bake target whose Dockerfile has no FROM line', () => {
    addImage('alpine', '# no FROM here\nRUN true\n');
    bakeReturns(['alpine']);
    expect(() => discoverBaseImages(baseDir)).toThrow(/"alpine": No valid FROM line found/);
  });

  test('rejects a bake target whose Dockerfile cannot be read', () => {
    // A directory named Dockerfile passes existsSync but fails to read.
    fs.mkdirSync(path.join(baseDir, 'alpine', 'Dockerfile'), { recursive: true });
    bakeReturns(['alpine']);
    expect(() => discoverBaseImages(baseDir)).toThrow(/Failed to parse Dockerfile for target "alpine"/);
  });

  test('skips an unreadable Dockerfile when there is no docker-bake.hcl', () => {
    fs.rmSync(path.join(baseDir, 'docker-bake.hcl'));
    addImage('grafana');
    fs.mkdirSync(path.join(baseDir, 'alpine', 'Dockerfile'), { recursive: true });
    expect(discoverBaseImages(baseDir).map((r) => r.directory)).toEqual(['grafana']);
    expect(execSync).not.toHaveBeenCalled();
  });
});
