import { existsSync } from 'fs';
import {
  CLASSIC_EVALUATORS,
  invalidFindings,
  SUGGESTIONS,
  supportedFor,
  THRESHOLD_EVALUATORS,
} from './evaluators.js';
import { listProvisioningFiles, PROVISIONED_EXTENSIONS, scanDirectory } from './scan.js';

export interface RunResult {
  /** Process exit code: 0 clean, 1 anything wrong. */
  code: number;
  /** Everything written to stdout. */
  out: string[];
  /** Everything written to stderr. */
  err: string[];
}

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Validates every provisioned alert evaluator under `dir`.
 *
 * Returns the report rather than printing it so the whole decision path is
 * unit-testable; `src/index.ts` is the thin shell that prints and exits.
 */
export function run (dir: string): RunResult {
  const out: string[] = [];
  const err: string[] = [];

  if (!existsSync(dir)) {
    err.push(`❌ Alert provisioning directory not found: ${dir}`, '   Run this from the repository root.');
    return { code: 1, out, err };
  }

  const files = listProvisioningFiles(dir);
  if (files.length === 0) {
    err.push(`❌ No provisioning files (${PROVISIONED_EXTENSIONS.join(', ')}) found in ${dir}`);
    return { code: 1, out, err };
  }

  out.push(`🔍 Checking evaluator types in ${files.length} file(s) under ${dir}`);
  out.push(`   classic_conditions accepts: ${CLASSIC_EVALUATORS.join(', ')}`);
  out.push(`   threshold accepts         : ${THRESHOLD_EVALUATORS.join(', ')}`);
  out.push('');

  const { findings, problems } = scanDirectory(dir);
  const invalid = invalidFindings(findings);

  for (const file of files) {
    const total = findings.filter((f) => f.file === file).length;
    const bad = invalid.filter((f) => f.file === file).length;
    const broken = problems.filter((p) => p.file === file).length;
    const suffix = [bad ? `${bad} invalid` : '', broken ? `${broken} unreadable` : ''].filter(Boolean).join(', ');
    out.push(`  ${bad === 0 && broken === 0 ? '✅' : '❌'} ${file} - ${total} evaluator(s)${suffix ? `, ${suffix}` : ''}`);
  }
  out.push('');

  // Fail closed: an evaluator that cannot be resolved is an unchecked evaluator.
  if (problems.length > 0) {
    err.push(RULE, `❌ ${problems.length} evaluator(s) could not be read - they are therefore unchecked.`, '');
    for (const problem of problems) {
      err.push(`  ${problem.file}`, `    at       : ${problem.path}`, `    rule uid : ${problem.uid}`, `    problem  : ${problem.message}`, '');
    }
    err.push('Every evaluator must resolve to `evaluator: { type: <string> }`.', RULE);
    return { code: 1, out, err };
  }

  if (invalid.length === 0) {
    out.push(`✅ All ${findings.length} evaluators use a type their expression supports.`);
    return { code: 0, out, err };
  }

  err.push(RULE, `❌ ${invalid.length} unsupported evaluator type(s) found.`, '');
  for (const finding of invalid) {
    err.push(`  ${finding.file}`);
    err.push(`    at        : ${finding.path}`);
    err.push(`    rule uid  : ${finding.uid}`);
    err.push(`    evaluator : type: ${finding.type}   <-- not supported`);
    err.push(`    expression: ${finding.modelType === 'unknown' ? 'classic_conditions (assumed - no enclosing model type found)' : finding.modelType}`);
    err.push(`    supported : ${supportedFor(finding.modelType).join(', ')}`);
    if (SUGGESTIONS[finding.type]) err.push(`    fix       : ${SUGGESTIONS[finding.type]}`);
    err.push('');
  }
  err.push(
    'An unsupported type does NOT fail provisioning. The rule is created,',
    'looks healthy in the UI, and then fails to build an evaluator on every',
    'scheduling tick ("Failed to build rule evaluator"), so it never',
    'evaluates its query. With execErrState: OK it reports Normal and',
    'nothing ever pages. See issues #1472 and #1475.',
    '',
    'See config/grafana/CLAUDE.md, "Supported classic_conditions evaluators".',
    RULE
  );
  return { code: 1, out, err };
}
