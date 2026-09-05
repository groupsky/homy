import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { scanDashboards } from '../../src/lib/dashboards.js';
import { runDashboardUnits, siFindings, subOneThresholdFindings, unexcusedFindings } from '../../src/lib/unit-report.js';
import { isSelfRescaling, SI_SCALING_UNITS, SI_UNIT_EXCEPTIONS } from '../../src/lib/units.js';

/** The repository's real dashboard directory, four levels above this package. */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const REAL_DASHBOARD_DIR = path.join(REPO_ROOT, 'config/grafana/dashboards');
const OVERVIEW = path.join(REAL_DASHBOARD_DIR, 'Ioniq EV/ioniq-overview.json');

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'dashboard-units-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write (relative: string, content: unknown): void {
  const full = path.join(dir, relative);
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, typeof content === 'string' ? content : JSON.stringify(content));
}

const statPanel = (id: number, title: string, unit: string) => ({
  id,
  type: 'stat',
  title,
  fieldConfig: { defaults: { unit, decimals: 2 }, overrides: [] },
});

/**
 * Issue #1481. The four raw tyre tiles rendered a flat tyre as `800.00 mbar`
 * because `pressurebar` is `SIPrefix('bar')`, which rescales below 1. This is
 * the assertion on the shipped dashboard, not on a fixture.
 */
describe('Ioniq EV / Overview tyre tiles', () => {
  const dashboard = JSON.parse(readFileSync(OVERVIEW, 'utf8')) as {
    panels: Array<{
      id: number;
      title: string;
      fieldConfig: { defaults: { unit: string; decimals: number } };
      targets?: Array<{ query?: string }>;
    }>;
  };
  const tyreTiles = dashboard.panels.filter((p) => [9, 10, 11, 12].includes(p.id));

  it('still has all four per-wheel tiles', () => {
    expect(tyreTiles.map((p) => p.title)).toEqual([
      'Tire FL (cold-start)',
      'Tire FR (cold-start)',
      'Tire RL (cold-start)',
      'Tire RR (cold-start)',
    ]);
  });

  /**
   * These tiles used to read the raw, temperature-uncompensated `<w>.psi` field
   * while the ioniq-tpms-<w>-psi-low/-psi-crit rules read
   * `derived/tire_<w>_bar_coldstart`. A tile could therefore sit green while its
   * own alert was firing, or turn amber straight after a motorway run on a tyre
   * that was perfectly fine. Colour and alert state must come from one series.
   */
  it.each([[9, 'fl'], [10, 'fr'], [11, 'rl'], [12, 'rr']])(
    'reads panel %i from the same cold-start series the alert rules read',
    (id, wheel) => {
      const query = tyreTiles.find((p) => p.id === id)!.targets![0].query!;

      expect(query).toContain(`derived/tire_${wheel}_bar_coldstart`);
      expect(query).not.toContain('.psi');
    });

  it.each([9, 10, 11, 12])('renders panel %i in bar at every value', (id) => {
    const tile = tyreTiles.find((p) => p.id === id)!;
    expect(SI_SCALING_UNITS.has(tile.fieldConfig.defaults.unit)).toBe(false);
    expect(tile.fieldConfig.defaults.unit).toBe('suffix: bar');
  });

  it('matches the unit the Ioniq EV / Tires panels already use', () => {
    const tires = JSON.parse(readFileSync(path.join(REAL_DASHBOARD_DIR, 'Ioniq EV/ioniq-tires.json'), 'utf8')) as {
      panels: Array<{ id: number; fieldConfig: { defaults: { unit?: string } } }>;
    };
    const coldStart = tires.panels.find((p) => p.id === 1)!;

    expect(tyreTiles[0].fieldConfig.defaults.unit).toBe(coldStart.fieldConfig.defaults.unit);
  });
});

describe('the repository\'s own dashboards', () => {
  it('passes the check', () => {
    const result = runDashboardUnits(REAL_DASHBOARD_DIR);

    expect(result.err).toEqual([]);
    expect(result.code).toBe(0);
  });

  it('leaves no self-rescaling unit undocumented', () => {
    const { findings, problems } = scanDashboards(REAL_DASHBOARD_DIR);

    expect(problems).toEqual([]);
    expect(unexcusedFindings(findings)).toEqual([]);
  });

  it('still contains self-rescaling units, so the check is not passing vacuously', () => {
    const { findings } = scanDashboards(REAL_DASHBOARD_DIR);

    expect(siFindings(findings).length).toBeGreaterThan(0);
  });

  it('uses no pressurebar anywhere', () => {
    const { findings } = scanDashboards(REAL_DASHBOARD_DIR);

    expect(findings.filter((f) => f.unit === 'pressurebar')).toEqual([]);
  });

  it('has no self-rescaling unit on a panel whose own threshold is below 1', () => {
    const { findings } = scanDashboards(REAL_DASHBOARD_DIR);

    expect(subOneThresholdFindings(findings)).toEqual([]);
  });

  it.each([
    ['sunseeker-battery.json', 3, 'suffix: A'],
    ['sunseeker-battery.json', 8, 'suffix: A'],
    ['heatpump.json', 2, 'suffix: W'],
  ])('gives %s panel %i a fixed unit, since its thresholds are in the base unit', (file, panelId, unit) => {
    const { findings } = scanDashboards(REAL_DASHBOARD_DIR);
    const panel = findings.filter((f) => f.file === file && f.panelId === panelId);

    expect(panel.length).toBeGreaterThan(0);
    expect(panel.every((f) => !isSelfRescaling(f.unit))).toBe(true);
    expect(panel.some((f) => f.unit === unit)).toBe(true);
  });

  /**
   * The two 12 V sag panels used to display volts against a 0.1 V threshold --
   * exactly where an SI unit rescales, so they were pinned to `suffix: V`. They
   * now show the sag EVENT COUNT rather than a latched level, because the signal
   * is raised on ~17% of samples while driving and no alert rule consumes it, so
   * colouring it red read as a standing fault. A count is dimensionless; what
   * must not come back is an SI unit on either panel.
   */
  it.each([3, 8])('keeps Ioniq EV/ioniq-12v-ldc.json panel %i off a self-rescaling unit', (panelId) => {
    const { findings } = scanDashboards(REAL_DASHBOARD_DIR);
    const panel = findings.filter((f) => f.file === 'Ioniq EV/ioniq-12v-ldc.json' && f.panelId === panelId);

    expect(panel.length).toBeGreaterThan(0);
    expect(panel.every((f) => !isSelfRescaling(f.unit))).toBe(true);
  });

  it('leaves no exception standing for a panel with a sub-1 threshold', () => {
    const { findings } = scanDashboards(REAL_DASHBOARD_DIR);
    const excusedKeys = new Set(SI_UNIT_EXCEPTIONS.map((e) => `${e.file}#${e.panelId}#${e.unit}`));

    for (const finding of subOneThresholdFindings(findings)) {
      expect(excusedKeys.has(`${finding.file}#${finding.panelId}#${finding.unit}`)).toBe(false);
    }
  });
});

describe('runDashboardUnits', () => {
  it('fails an undocumented pressurebar panel, naming panel and unit', () => {
    write('Ioniq EV/ioniq-overview.json', { panels: [statPanel(9, 'Tire FL', 'pressurebar')] });

    const result = runDashboardUnits(dir);
    const err = result.err.join('\n');

    expect(result.code).toBe(1);
    expect(err).toContain('1 undocumented use(s) of a self-rescaling unit');
    expect(err).toContain('Ioniq EV/ioniq-overview.json');
    expect(err).toContain('9 - Tire FL');
    expect(err).toContain('pressurebar');
    expect(err).toContain('suffix: bar');
  });

  it('fails an undocumented unit set through an override', () => {
    write('new-dashboard.json', {
      panels: [
        {
          id: 4,
          type: 'timeseries',
          title: 'Pressure',
          fieldConfig: { defaults: {}, overrides: [{ matcher: { id: 'byName', options: 'p' }, properties: [{ id: 'unit', value: 'pressurepa' }] }] },
        },
      ],
    });

    const result = runDashboardUnits(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('pressurepa');
  });

  it('passes a dashboard using only fixed-suffix units', () => {
    write('fine.json', { panels: [statPanel(1, 'FL bar', 'suffix: bar'), statPanel(2, 'Temp', 'celsius')] });

    // Every documented exception names a panel that this fixture lacks, so the
    // staleness check would fire first - assert on the unit findings instead.
    const { findings, problems } = scanDashboards(dir);
    expect(problems).toEqual([]);
    expect(unexcusedFindings(findings)).toEqual([]);
    expect(siFindings(findings)).toEqual([]);
  });

  it('refuses to excuse a panel whose own threshold is a negative sub-unit value', () => {
    // scaledUnits scales on Math.abs(size): -0.5 A renders "-500.00 mA" exactly
    // as 0.5 A renders "500.00 mA". A mower's charging current is written
    // negative, so a sign-blind rule would have excused the same pathology.
    write('sunseeker-battery.json', {
      panels: [
        {
          id: 3,
          type: 'stat',
          title: 'Battery Current',
          fieldConfig: {
            defaults: {
              unit: 'amp',
              thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: -0.5 }] },
            },
          },
        },
      ],
    });

    const { findings } = scanDashboards(dir);
    expect(subOneThresholdFindings(findings)).toHaveLength(1);

    const err = runDashboardUnits(dir).err.join('\n');
    expect(err).toContain('cannot be excused');
    expect(err).toContain('-0.5');
  });

  it('does not treat a threshold of exactly 0 as sub-unit', () => {
    // size === 0 is special-cased to index 0 and renders in the base unit.
    write('new-dashboard.json', {
      panels: [
        {
          id: 1,
          type: 'stat',
          title: 'Zeroed',
          fieldConfig: {
            defaults: {
              unit: 'watt',
              thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: 0 }] },
            },
          },
        },
      ],
    });

    expect(subOneThresholdFindings(scanDashboards(dir).findings)).toEqual([]);
  });

  it('refuses to excuse a panel whose own threshold is below 1', () => {
    // boiler-controller.json panel 9 IS a documented exception for `watt`.
    // Giving it a 0.5 W threshold must fail anyway: the dashboard's own
    // threshold says the series lives where the formatter switches units.
    write('boiler-controller.json', {
      panels: [
        {
          id: 9,
          type: 'timeseries',
          title: 'Boiler Power Consumption',
          fieldConfig: {
            defaults: {
              unit: 'watt',
              thresholds: { mode: 'absolute', steps: [{ color: 'green', value: null }, { color: 'red', value: 0.5 }] },
            },
          },
        },
      ],
    });

    const { findings } = scanDashboards(dir);
    expect(subOneThresholdFindings(findings)).toHaveLength(1);
    expect(unexcusedFindings(findings)).toHaveLength(1);

    const err = runDashboardUnits(dir).err.join('\n');
    expect(err).toContain('cannot be excused');
    expect(err).toContain('0.5');
  });

  it('fails an undocumented dynamic si: unit', () => {
    write('new-dashboard.json', { panels: [statPanel(4, 'Pressure', 'si: bar')] });

    const result = runDashboardUnits(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('si: bar');
  });

  it('fails an undocumented unit on a legacy graph panel axis', () => {
    write('new-dashboard.json', { panels: [{ id: 5, type: 'graph', title: 'Legacy', yaxes: [{ format: 'pressurebar' }] }] });

    const result = runDashboardUnits(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('yaxes[0].format');
  });

  it('fails when a documented exception no longer matches any panel', () => {
    write('boiler-controller.json', { panels: [statPanel(9, 'Boiler Power Consumption', 'suffix: W')] });

    const result = runDashboardUnits(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('no longer match any panel');
    expect(result.err.join('\n')).toContain('boiler-controller.json');
  });

  it('fails, rather than skipping, a dashboard it cannot read', () => {
    write('broken.json', '{ not json');

    const result = runDashboardUnits(dir);
    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('could not be read');
  });

  it('fails when the dashboard directory does not exist', () => {
    const result = runDashboardUnits(path.join(dir, 'nope'));

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('Dashboard directory not found');
  });

  it('fails when the dashboard directory holds no dashboards', () => {
    const result = runDashboardUnits(dir);

    expect(result.code).toBe(1);
    expect(result.err.join('\n')).toContain('No dashboard files');
  });

  it('lists every dashboard it looked at', () => {
    const result = runDashboardUnits(REAL_DASHBOARD_DIR);

    expect(result.out.join('\n')).toContain('Ioniq EV/ioniq-overview.json');
    expect(result.out.join('\n')).toContain('Checking units in 13 dashboard(s)');
  });
});
