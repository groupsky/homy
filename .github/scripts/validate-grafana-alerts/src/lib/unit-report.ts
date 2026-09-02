import { existsSync } from 'fs';
import { listDashboardFiles, scanDashboards } from './dashboards.js';
import type { UnitFinding } from './types.js';
import { exceptionKey, isSelfRescaling, SI_SCALING_UNITS, SI_UNIT_EXCEPTIONS } from './units.js';
import type { RunResult } from './report.js';

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/** Findings whose unit rescales itself, keyed for matching against the exceptions. */
export function siFindings (findings: readonly UnitFinding[]): UnitFinding[] {
  return findings.filter((f) => isSelfRescaling(f.unit));
}

/**
 * Whether a threshold step lands where an SI-prefixed unit rescales.
 *
 * `scaledUnits` takes `Math.floor(log1000(Math.abs(size)))`, so the sign is
 * irrelevant: -0.5 A renders `-500.00 mA` exactly as 0.5 A renders `500.00 mA`.
 * A mower's charging current, written negative, is the same pathology. Zero is
 * excluded because `size === 0` is special-cased to index 0 and renders in the
 * base unit.
 */
function isSubUnitThreshold (value: number): boolean {
  return Math.abs(value) < 1 && value !== 0;
}

/**
 * SI-scaling findings on a panel with a threshold below 1 in magnitude, which
 * no exception can excuse.
 *
 * A threshold is written in the panel's base unit. A step below 1 therefore
 * says, in the dashboard's own words, that the interesting part of this series
 * lies exactly where the formatter switches units - the tile reads `100.00 mV`
 * beside a threshold written `0.1`. That is the #1481 pathology, and it is not
 * a judgement call, so it is not delegated to a written reason.
 *
 * Two panels on `Ioniq EV / 12 V & LDC` (`12 V Sag`, threshold 0.1 V) were
 * excused in the first draft of this check with a reason that claimed no
 * threshold on the dashboard was denominated in volts. It was wrong. This rule
 * exists so the same mistake cannot be made in prose again.
 */
export function subOneThresholdFindings (findings: readonly UnitFinding[]): UnitFinding[] {
  return siFindings(findings).filter((f) => f.thresholds.some(isSubUnitThreshold));
}

/** SI-scaling findings with no entry in `SI_UNIT_EXCEPTIONS`. */
export function unexcusedFindings (findings: readonly UnitFinding[]): UnitFinding[] {
  const excused = new Set(SI_UNIT_EXCEPTIONS.map((e) => exceptionKey(e.file, e.panelId, e.unit)));
  const inexcusable = new Set(subOneThresholdFindings(findings).map((f) => exceptionKey(f.file, f.panelId, f.unit)));
  return siFindings(findings).filter(
    (f) => inexcusable.has(exceptionKey(f.file, f.panelId, f.unit)) || !excused.has(exceptionKey(f.file, f.panelId, f.unit))
  );
}

/**
 * Exceptions naming a panel/unit pair that no longer exists.
 *
 * A registry that only grows stops being a record of decisions and becomes
 * noise. It also catches the common case of a panel being fixed without its
 * entry being removed. It does not catch a panel id being reused for a
 * different series that happens to keep the same unit - the key is
 * file/id/unit, not the series - so a repurposed panel still needs a human.
 */
export function staleExceptions (findings: readonly UnitFinding[]): typeof SI_UNIT_EXCEPTIONS {
  const present = new Set(siFindings(findings).map((f) => exceptionKey(f.file, f.panelId, f.unit)));
  return SI_UNIT_EXCEPTIONS.filter((e) => !present.has(exceptionKey(e.file, e.panelId, e.unit)));
}

/**
 * Checks every provisioned dashboard under `dir` for self-rescaling units.
 *
 * Grafana's SI-prefixed units multiply by 1000 and change their suffix below 1,
 * so a panel in bar shows `800.00 mbar` for a flat tyre - issue #1481. Any
 * panel using such a unit has to be listed in `SI_UNIT_EXCEPTIONS` with a
 * reason, which forces the question to be answered once, in writing, per panel.
 *
 * Returns the report rather than printing it, matching `report.ts`.
 */
export function runDashboardUnits (dir: string): RunResult {
  const out: string[] = [];
  const err: string[] = [];

  if (!existsSync(dir)) {
    err.push(`❌ Dashboard directory not found: ${dir}`, '   Run this from the repository root.');
    return { code: 1, out, err };
  }

  const files = listDashboardFiles(dir);
  if (files.length === 0) {
    err.push(`❌ No dashboard files (.json) found in ${dir}`);
    return { code: 1, out, err };
  }

  out.push(`🔍 Checking units in ${files.length} dashboard(s) under ${dir}`);
  out.push(`   ${SI_SCALING_UNITS.size} Grafana units rescale themselves below 1 (SIPrefix)`);
  out.push(`   ${SI_UNIT_EXCEPTIONS.length} panel(s) are documented as intentional`);
  out.push('');

  const { findings, problems } = scanDashboards(dir);
  const unexcused = unexcusedFindings(findings);
  const stale = staleExceptions(findings);

  for (const file of files) {
    const total = findings.filter((f) => f.file === file).length;
    const si = siFindings(findings.filter((f) => f.file === file)).length;
    const bad = unexcused.filter((f) => f.file === file).length;
    const broken = problems.filter((p) => p.file === file).length;
    const notes = [si ? `${si} self-rescaling` : '', bad ? `${bad} undocumented` : '', broken ? `${broken} unreadable` : ''].filter(Boolean).join(', ');
    out.push(`  ${bad === 0 && broken === 0 ? '✅' : '❌'} ${file} - ${total} unit(s)${notes ? `, ${notes}` : ''}`);
  }
  out.push('');

  // Fail closed: a unit that cannot be read or placed is an unchecked unit.
  if (problems.length > 0) {
    err.push(RULE, `❌ ${problems.length} unit(s) could not be read - they are therefore unchecked.`, '');
    for (const problem of problems) {
      err.push(`  ${problem.file}`, `    at      : ${problem.path}`, `    problem : ${problem.message}`, '');
    }
    err.push(RULE);
    return { code: 1, out, err };
  }

  if (unexcused.length > 0) {
    err.push(RULE, `❌ ${unexcused.length} undocumented use(s) of a self-rescaling unit.`, '');
    for (const finding of unexcused) {
      err.push(`  ${finding.file}`);
      err.push(`    at        : ${finding.path}`);
      err.push(`    panel     : ${finding.panelId} - ${finding.panelTitle}`);
      err.push(`    unit      : ${finding.unit}   <-- rescales below 1`);
      if (finding.thresholds.some(isSubUnitThreshold)) {
        err.push(`    threshold : ${finding.thresholds.filter(isSubUnitThreshold).join(', ')}   <-- below 1 in this unit; cannot be excused`);
      }
      err.push('');
    }
    err.push(
      'These units are SIPrefix formatters: below 1 they multiply the value by',
      '1000 and change the suffix, so a panel in bar renders 0.80 as',
      '"800.00 mbar" - in red, correctly, and in the wrong unit. See #1481.',
      '',
      'Either give the panel a fixed unit ("suffix: bar" is the pattern used',
      'here), or add it to SI_UNIT_EXCEPTIONS in src/lib/units.ts with a reason',
      'saying why the series cannot go below 1, or why the smaller prefix reads',
      'correctly there. A panel with a threshold below 1 in this unit can only',
      'be fixed - its own thresholds say the series lives where the formatter',
      'switches units. Sign does not matter: the formatter scales on |value|.',
      '',
      'See config/grafana/CLAUDE.md, "SI-prefixed units change unit below 1".',
      RULE
    );
  }

  // Reported alongside, not instead of, the above: a run that fixed one panel
  // and left another undocumented should say both things at once.
  if (stale.length > 0) {
    err.push(RULE, `❌ ${stale.length} documented exception(s) no longer match any panel.`, '');
    for (const exception of stale) {
      err.push(`  ${exception.file}`, `    panel id : ${exception.panelId}`, `    unit     : ${exception.unit}`, '');
    }
    err.push('Remove them from SI_UNIT_EXCEPTIONS in src/lib/units.ts. A stale entry', 'pre-approves whatever takes that panel id next.', RULE);
  }

  if (err.length > 0) return { code: 1, out, err };

  out.push(`✅ All ${siFindings(findings).length} self-rescaling unit(s) are documented as intentional.`);
  return { code: 0, out, err };
}
