import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import type { UnitFinding, UnitProblem, UnitScanResult } from './types.js';

export const NO_PANEL_TITLE = '(panel has no title)';

/**
 * Provisioned dashboard files under `dir`, recursively, as paths relative to it.
 *
 * Grafana's dashboard provisioner walks the configured folder tree, so a
 * dashboard one directory down (`Ioniq EV/ioniq-overview.json`) is as
 * provisioned as one at the top. Returned relative and `/`-separated so the
 * paths match `SI_UNIT_EXCEPTIONS` entries on any platform.
 */
export function listDashboardFiles (dir: string): string[] {
  const found: string[] = [];

  function walk (current: string): void {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (path.extname(entry.name).toLowerCase() === '.json') found.push(path.relative(dir, full).split(path.sep).join('/'));
    }
  }

  walk(dir);
  return found;
}

/**
 * A panel is an object with a numeric `id` and a string `type`.
 *
 * That is enough to separate panels from everything else a dashboard holds
 * with an `id`: datasource references (`id` is absent, `uid` is a string),
 * field overrides (`id` is a string like `"unit"`) and templating variables.
 * Rows match too, which is what we want - they enclose the panels inside them.
 */
function isPanel (record: Record<string, unknown>): boolean {
  return typeof record.id === 'number' && typeof record.type === 'string';
}

/** Numeric `fieldConfig.defaults.thresholds.steps[].value` of a panel. */
function panelThresholds (record: Record<string, unknown>): number[] {
  const defaults = (record.fieldConfig as Record<string, unknown> | undefined)?.defaults as Record<string, unknown> | undefined;
  const steps = (defaults?.thresholds as Record<string, unknown> | undefined)?.steps;
  if (!Array.isArray(steps)) return [];
  return steps
    .map((step) => (step as Record<string, unknown> | null)?.value)
    .filter((value): value is number => typeof value === 'number');
}

/**
 * Collects every unit a dashboard sets, with the panel that sets it.
 *
 * Structural rather than textual, and deliberately covering both spellings
 * Grafana uses, because a check that saw only one of them would pass a
 * dashboard it never really looked at:
 *
 * - `fieldConfig.defaults.unit: "volt"` - the panel-wide unit.
 * - `fieldConfig.overrides[].properties[]` entries of the shape
 *   `{ id: "unit", value: "volt" }` - a per-series unit. Six dashboards here
 *   use these, and several set a unit found nowhere else in the file.
 * - `yaxes[].format` - where a legacy angular `graph` panel keeps its axis
 *   unit. `reminders.json` still has four of them. Read only inside a `yaxes`
 *   array, because `format` elsewhere in a dashboard means something else
 *   entirely (an InfluxDB target's `"format": "time_series"`).
 *
 * `unit` keys outside a panel, and units on a panel with no numeric `id`, are
 * reported as problems rather than ignored: they cannot be matched against the
 * exception list, so passing them would be vouching for something unread.
 */
export function collectUnits (root: unknown, file: string): UnitScanResult {
  const findings: UnitFinding[] = [];
  const problems: UnitProblem[] = [];
  const visited = new Set<object>();

  interface Panel { id: number | null; title: string; thresholds: number[] }

  function record (unit: unknown, at: string, panel: Panel): void {
    if (typeof unit !== 'string') {
      problems.push({ file, path: at, message: `unit is ${unit === null ? 'null' : typeof unit}, expected a string` });
      return;
    }
    if (panel.id === null) {
      problems.push({ file, path: at, message: `unit "${unit}" is not inside a panel with a numeric \`id\`` });
      return;
    }
    findings.push({ file, path: at, panelId: panel.id, panelTitle: panel.title, unit, thresholds: panel.thresholds });
  }

  function walk (node: unknown, at: string, panel: Panel): void {
    if (typeof node !== 'object' || node === null) return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${at}[${i}]`, panel));
      return;
    }

    const obj = node as Record<string, unknown>;

    let current = panel;
    if (isPanel(obj)) {
      current = {
        id: obj.id as number,
        title: typeof obj.title === 'string' && obj.title.length > 0 ? obj.title : NO_PANEL_TITLE,
        thresholds: panelThresholds(obj),
      };
    }

    if (Object.prototype.hasOwnProperty.call(obj, 'unit')) {
      record(obj.unit, `${at}.unit`, current);
    }
    // Field override property: { id: "unit", value: "volt" }
    if (obj.id === 'unit' && Object.prototype.hasOwnProperty.call(obj, 'value')) {
      record(obj.value, `${at}.value`, current);
    }
    // Legacy angular graph panel: yaxes[].format holds the axis unit.
    if (Array.isArray(obj.yaxes)) {
      obj.yaxes.forEach((axis, i) => {
        if (axis && typeof axis === 'object' && Object.prototype.hasOwnProperty.call(axis, 'format')) {
          record((axis as Record<string, unknown>).format, `${at}.yaxes[${i}].format`, current);
        }
      });
    }

    for (const [key, value] of Object.entries(obj)) {
      walk(value, at ? `${at}.${key}` : key, current);
    }
  }

  walk(root, '', { id: null, title: NO_PANEL_TITLE, thresholds: [] });
  return { findings, problems };
}

/** Parses one dashboard and collects its units. */
export function scanDashboard (dir: string, file: string): UnitScanResult {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path.join(dir, file), 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { findings: [], problems: [{ file, path: '(file)', message: `cannot be parsed: ${message}` }] };
  }
  return collectUnits(document, file);
}

/** Collects the units of every dashboard under `dir`. */
export function scanDashboards (dir: string): UnitScanResult {
  const findings: UnitFinding[] = [];
  const problems: UnitProblem[] = [];
  for (const file of listDashboardFiles(dir)) {
    const result = scanDashboard(dir, file);
    findings.push(...result.findings);
    problems.push(...result.problems);
  }
  return { findings, problems };
}
