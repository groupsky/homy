import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { collectUnits, listDashboardFiles, NO_PANEL_TITLE, scanDashboard, scanDashboards } from '../../src/lib/dashboards.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dashboards-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write (relative: string, content: unknown): void {
  const full = path.join(dir, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
}

const panel = (id: number, title: string, unit: string) => ({
  id,
  type: 'stat',
  title,
  fieldConfig: { defaults: { unit, decimals: 2 }, overrides: [] },
});

describe('listDashboardFiles', () => {
  it('finds dashboards in subdirectories, relative and slash-separated', () => {
    write('top.json', {});
    write('Ioniq EV/nested.json', {});

    expect(listDashboardFiles(dir)).toEqual(['Ioniq EV/nested.json', 'top.json']);
  });

  it('ignores files Grafana would not load as a dashboard', () => {
    write('a.json', {});
    write('README.md', 'not a dashboard');
    write('b.yaml', 'nope: true');

    expect(listDashboardFiles(dir)).toEqual(['a.json']);
  });

  it('accepts an uppercase extension', () => {
    write('LOUD.JSON', {});

    expect(listDashboardFiles(dir)).toEqual(['LOUD.JSON']);
  });

  it('returns an empty list for an empty directory', () => {
    expect(listDashboardFiles(dir)).toEqual([]);
  });
});

describe('collectUnits', () => {
  it('reads the panel-wide unit with its panel id and title', () => {
    const result = collectUnits({ panels: [panel(9, 'Tire FL', 'pressurebar')] }, 'd.json');

    expect(result.problems).toEqual([]);
    expect(result.findings).toEqual([
      {
        file: 'd.json',
        path: 'panels[0].fieldConfig.defaults.unit',
        panelId: 9,
        panelTitle: 'Tire FL',
        unit: 'pressurebar',
        thresholds: [],
      },
    ]);
  });

  it('reads a per-series unit set through a field override', () => {
    const result = collectUnits(
      {
        panels: [
          {
            id: 9,
            type: 'timeseries',
            title: 'Throughput',
            fieldConfig: {
              defaults: {},
              overrides: [
                { matcher: { id: 'byName', options: 'Energy In' }, properties: [{ id: 'unit', value: 'kwatth' }, { id: 'decimals', value: 2 }] },
              ],
            },
          },
        ],
      },
      'd.json'
    );

    expect(result.problems).toEqual([]);
    expect(result.findings.map((f) => f.unit)).toEqual(['kwatth']);
    expect(result.findings[0].panelId).toBe(9);
  });

  it('does not mistake the override matcher id for a unit', () => {
    const result = collectUnits(
      {
        panels: [
          {
            id: 1,
            type: 'timeseries',
            title: 'T',
            fieldConfig: { defaults: {}, overrides: [{ matcher: { id: 'byName', options: 'unit' }, properties: [] }] },
          },
        ],
      },
      'd.json'
    );

    expect(result.findings).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it('attributes units inside a row to the panel that sets them', () => {
    const result = collectUnits(
      { panels: [{ id: 100, type: 'row', title: 'Row', panels: [panel(7, 'Inner', 'volt')] }] },
      'd.json'
    );

    expect(result.findings.map((f) => [f.panelId, f.panelTitle, f.unit])).toEqual([[7, 'Inner', 'volt']]);
  });

  it('names a panel with no title', () => {
    const result = collectUnits({ panels: [{ id: 3, type: 'stat', fieldConfig: { defaults: { unit: 'volt' } } }] }, 'd.json');

    expect(result.findings[0].panelTitle).toBe(NO_PANEL_TITLE);
  });

  it('reports a unit that is not a string rather than skipping it', () => {
    const result = collectUnits({ panels: [{ id: 3, type: 'stat', fieldConfig: { defaults: { unit: null } } }] }, 'd.json');

    expect(result.findings).toEqual([]);
    expect(result.problems).toEqual([
      { file: 'd.json', path: 'panels[0].fieldConfig.defaults.unit', message: 'unit is null, expected a string' },
    ]);
  });

  it('reports a unit that belongs to no panel', () => {
    const result = collectUnits({ fieldConfig: { defaults: { unit: 'volt' } } }, 'd.json');

    expect(result.findings).toEqual([]);
    expect(result.problems[0].message).toContain('is not inside a panel');
  });

  it('survives a self-referential structure', () => {
    const cyclic: Record<string, unknown> = { panels: [panel(1, 'A', 'volt')] };
    cyclic.self = cyclic;

    expect(() => collectUnits(cyclic, 'd.json')).not.toThrow();
    expect(collectUnits(cyclic, 'd.json').findings).toHaveLength(1);
  });

  it('reads the axis unit of a legacy angular graph panel', () => {
    const result = collectUnits(
      {
        panels: [
          {
            id: 1,
            type: 'graph',
            title: 'Legacy',
            yaxes: [{ format: 'watt', show: true }, { format: 'short', show: false }],
          },
        ],
      },
      'd.json'
    );

    expect(result.problems).toEqual([]);
    expect(result.findings.map((f) => [f.path, f.unit])).toEqual([
      ['panels[0].yaxes[0].format', 'watt'],
      ['panels[0].yaxes[1].format', 'short'],
    ]);
  });

  it('does not treat a query target\'s `format` as a unit', () => {
    const result = collectUnits(
      {
        panels: [
          { id: 1, type: 'timeseries', title: 'T', targets: [{ refId: 'A', format: 'time_series' }] },
        ],
      },
      'd.json'
    );

    expect(result.findings).toEqual([]);
    expect(result.problems).toEqual([]);
  });

  it('carries the panel\'s absolute thresholds with each unit', () => {
    const result = collectUnits(
      {
        panels: [
          {
            id: 3,
            type: 'stat',
            title: '12 V Sag',
            fieldConfig: {
              defaults: {
                unit: 'volt',
                thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: 0.1 }] },
              },
            },
          },
        ],
      },
      'd.json'
    );

    // The `null` first step is Grafana's "-Infinity" base and is not a number.
    expect(result.findings[0].thresholds).toEqual([0.1]);
  });

  it('finds nothing in a dashboard that sets no units', () => {
    expect(collectUnits({ panels: [{ id: 1, type: 'text', title: 'Notes' }] }, 'd.json')).toEqual({ findings: [], problems: [] });
  });
});

describe('scanDashboard', () => {
  it('reports an unparsable dashboard as a problem rather than throwing', () => {
    write('broken.json', '{ not json');

    const result = scanDashboard(dir, 'broken.json');
    expect(result.findings).toEqual([]);
    expect(result.problems[0].message).toContain('cannot be parsed');
  });
});

describe('scanDashboards', () => {
  it('collects across every dashboard in the tree', () => {
    write('a.json', { panels: [panel(1, 'A', 'volt')] });
    write('sub/b.json', { panels: [panel(2, 'B', 'watt')] });

    const result = scanDashboards(dir);
    expect(result.findings.map((f) => [f.file, f.unit])).toEqual([
      ['a.json', 'volt'],
      ['sub/b.json', 'watt'],
    ]);
  });
});
