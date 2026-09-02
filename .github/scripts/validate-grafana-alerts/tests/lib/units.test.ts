import { describe, expect, it } from '@jest/globals';
import { exceptionKey, isSelfRescaling, SI_SCALING_UNITS, SI_UNIT_EXCEPTIONS } from '../../src/lib/units.js';
import { format, rendered } from './grafana-value-format.js';

/**
 * The evidence for issue #1481, as a test rather than a screenshot.
 *
 * `rendered()` runs Grafana 9.5.21's own formatter, transcribed from the
 * deployed image's source maps - see `grafana-value-format.ts`.
 */
describe('what Grafana 9.5.21 renders for a sub-1-bar tyre', () => {
  it('renders 0.80 bar as "800.00 mbar" under pressurebar - the bug', () => {
    expect(rendered('pressurebar', 0.80, 2)).toBe('800.00 mbar');
  });

  it('renders 0.80 bar as "0.80 bar" under "suffix: bar" - the fix', () => {
    expect(rendered('suffix: bar', 0.80, 2)).toBe('0.80 bar');
  });

  it.each([2.07, 2.2, 2.6, 2.9])('agrees on a healthy tyre at %s bar', (value) => {
    expect(rendered('pressurebar', value, 2)).toBe(`${value.toFixed(2)} bar`);
    expect(rendered('suffix: bar', value, 2)).toBe(`${value.toFixed(2)} bar`);
  });

  it('keeps "suffix: bar" in bar across the whole plausible range', () => {
    for (const value of [0, 0.01, 0.21, 0.8, 1, 2.35, 12]) {
      expect(rendered('suffix: bar', value, 2)).toBe(`${value.toFixed(2)} bar`);
    }
  });

  it('shows how far pressurebar drifts as the tyre deflates', () => {
    // The three values quoted in issue #1481, reproduced.
    expect(rendered('pressurebar', 0.21, 3)).toBe('210.000 mbar');
    expect(rendered('pressurebar', 0.80, 3)).toBe('800.000 mbar');
    expect(rendered('pressurebar', 2.07, 3)).toBe('2.070 bar');
  });

  it('scales the suffix rather than clamping it, unlike pressurepsi', () => {
    // pressurepsi is scaledUnits with offset 0, so it never picks a smaller
    // prefix - which is why this only started mattering when panels moved to bar.
    // No leading space in pressurepsi's suffix array - that is Grafana's, not a typo.
    expect(rendered('pressurepsi', 0.8, 2)).toBe('0.80psi');
    expect(format('pressurebar', 0.8, 2).suffix).toBe(' mbar');
  });
});

describe('SI_SCALING_UNITS', () => {
  it.each(['pressurebar', 'pressurepa', 'volt', 'amp', 'watt', 'mvolt', 'kwatt', 'kwatth'])(
    'includes %s, which rescales below 1',
    (unit) => {
      expect(SI_SCALING_UNITS.has(unit)).toBe(true);
    }
  );

  it.each(['celsius', 'kelvin', 'humidity', 'degree', 'percent', 'percentunit', 'none', 'short', 'pressurepsi', 'string', 'bool'])(
    'excludes %s, which has a fixed suffix or clamps at 0',
    (unit) => {
      expect(SI_SCALING_UNITS.has(unit)).toBe(false);
    }
  );

  it('excludes custom suffix units', () => {
    expect(SI_SCALING_UNITS.has('suffix: bar')).toBe(false);
    expect(SI_SCALING_UNITS.has('suffix: km')).toBe(false);
  });

  it('holds every SIPrefix unit in Grafana 9.5.21', () => {
    expect(SI_SCALING_UNITS.size).toBe(103);
  });
});

describe('isSelfRescaling', () => {
  it('accepts the fixed SIPrefix ids', () => {
    expect(isSelfRescaling('pressurebar')).toBe(true);
    expect(isSelfRescaling('volt')).toBe(true);
  });

  it('accepts Grafana\'s dynamic si: spelling, which builds SIPrefix too', () => {
    // getValueFormat splits on the first colon; key "si" maps to
    // SIPrefix(unit, getOffsetFromSIPrefix(...)). "si: bar" is pressurebar.
    expect(isSelfRescaling('si: bar')).toBe(true);
    expect(isSelfRescaling('si:mbar')).toBe(true);
  });

  it('rejects the fixed-suffix spellings', () => {
    expect(isSelfRescaling('suffix: bar')).toBe(false);
    expect(isSelfRescaling('prefix: $')).toBe(false);
    expect(isSelfRescaling('celsius')).toBe(false);
    expect(isSelfRescaling('time: YYYY-MM-DD')).toBe(false);
  });

  it('does not treat a leading colon as a key', () => {
    expect(isSelfRescaling(':si')).toBe(false);
  });
});

describe('SI_UNIT_EXCEPTIONS', () => {
  it('gives every exception a reason', () => {
    for (const exception of SI_UNIT_EXCEPTIONS) {
      expect(exception.reason.length).toBeGreaterThan(40);
    }
  });

  it('only excuses units that actually rescale', () => {
    for (const exception of SI_UNIT_EXCEPTIONS) {
      expect(SI_SCALING_UNITS.has(exception.unit)).toBe(true);
    }
  });

  it('holds no duplicate panel/unit pairs', () => {
    const keys = SI_UNIT_EXCEPTIONS.map((e) => exceptionKey(e.file, e.panelId, e.unit));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses forward slashes so paths match on any platform', () => {
    for (const exception of SI_UNIT_EXCEPTIONS) {
      expect(exception.file).not.toContain('\\');
    }
  });

  it('does not excuse the Ioniq tyre tiles - those were fixed', () => {
    const tyreTiles = SI_UNIT_EXCEPTIONS.filter(
      (e) => e.file === 'Ioniq EV/ioniq-overview.json' && [9, 10, 11, 12].includes(e.panelId)
    );
    expect(tyreTiles).toEqual([]);
  });

  it.each([
    ['Ioniq EV/ioniq-12v-ldc.json', 3],
    ['Ioniq EV/ioniq-12v-ldc.json', 8],
    ['sunseeker-battery.json', 3],
    ['sunseeker-battery.json', 8],
    ['heatpump.json', 2],
  ])('does not excuse %s panel %i, whose thresholds contradicted the reason', (file, panelId) => {
    expect(SI_UNIT_EXCEPTIONS.filter((e) => e.file === file && e.panelId === panelId)).toEqual([]);
  });
});
