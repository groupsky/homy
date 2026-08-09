import type { EvaluatorFinding, EvaluatorProblem, ModelType, ScanResult } from './types.js';

/**
 * Evaluator types accepted by `classic_conditions`.
 *
 * Grafana 9.5.21, `pkg/expr/classic/classic.go` -> `newAlertEvaluator`.
 */
export const CLASSIC_EVALUATORS = ['gt', 'lt', 'within_range', 'outside_range', 'no_value'] as const;

/**
 * Evaluator types accepted by the `threshold` expression.
 *
 * Grafana 9.5.21, `pkg/expr/threshold.go` -> `supportedThresholdFuncs`, which is
 * `{gt, lt, within_range, outside_range}`. It omits `no_value`, so the two
 * expression types do NOT share one list and the check cannot apply a flat set.
 */
export const THRESHOLD_EVALUATORS = ['gt', 'lt', 'within_range', 'outside_range'] as const;

/** Rewrite hints for the mistakes that actually reach production. */
export const SUGGESTIONS: Readonly<Record<string, string>> = {
  gte: 'use `gt` with the threshold lowered by one step (`gte 1` on a count is `gt 0`)',
  lte: 'use `lt` with the threshold raised by one step (`lte 1` on a count is `lt 2`)',
  eq: 'use `within_range` around the value',
  ne: 'use `outside_range` around the value',
  no_value: 'valid for classic_conditions but NOT for a `threshold` expression',
};

export const NO_UID = '(rule has no uid)';

/** Evaluator types allowed inside the given expression model. */
export function supportedFor (modelType: ModelType): readonly string[] {
  return modelType === 'threshold' ? THRESHOLD_EVALUATORS : CLASSIC_EVALUATORS;
}

function isRecord (value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Walks a parsed provisioning document and resolves every `evaluator`.
 *
 * Structural, not textual. An earlier version of this check scanned lines with
 * regexes and was defeated by four separate spellings of the same YAML - a
 * leading `{`, two evaluators on one line, a quoted `"evaluator":` key, and a
 * `.json` file - each of which made it report zero evaluators and exit 0. Any
 * object carrying an `evaluator` key is an evaluator host no matter how the
 * document is formatted, so walking the parsed tree kills that class outright.
 *
 * Cycle-guarded: YAML anchors can produce genuinely cyclic structures
 * (`a: &x [*x]` parses to an array containing itself), which would otherwise
 * recurse forever. Merge keys and aliases are already resolved by the parser,
 * so an evaluator inherited through `<<:` is visible here like any other.
 *
 * @param root parsed document (one YAML document, or a whole JSON file)
 * @param file path reported alongside each result
 * @param basePath path prefix, used to distinguish documents in a multi-doc file
 */
export function collectEvaluators (root: unknown, file: string, basePath = ''): ScanResult {
  const findings: EvaluatorFinding[] = [];
  const problems: EvaluatorProblem[] = [];
  const visited = new Set<object>();

  function walk (node: unknown, path: string, uid: string, modelType: ModelType): void {
    if (typeof node !== 'object' || node === null) return;
    if (visited.has(node)) return;
    visited.add(node);

    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${path}[${i}]`, uid, modelType));
      return;
    }

    const record = node as Record<string, unknown>;

    let currentUid = uid;
    if (typeof record.uid === 'string' && record.uid.length > 0) currentUid = record.uid;

    let currentModel = modelType;
    if (record.type === 'classic_conditions') currentModel = 'classic_conditions';
    else if (record.type === 'threshold') currentModel = 'threshold';

    if (Object.prototype.hasOwnProperty.call(record, 'evaluator')) {
      const evaluator = record.evaluator;
      const evaluatorPath = `${path}.evaluator`;
      if (!isRecord(evaluator)) {
        problems.push({
          file,
          path: evaluatorPath,
          uid: currentUid,
          message: `evaluator is ${Array.isArray(evaluator) ? 'a sequence' : `a ${evaluator === null ? 'null' : typeof evaluator}`}, expected a mapping with a \`type\``,
        });
      } else if (!Object.prototype.hasOwnProperty.call(evaluator, 'type')) {
        problems.push({ file, path: evaluatorPath, uid: currentUid, message: 'evaluator has no `type`' });
      } else if (typeof evaluator.type !== 'string') {
        problems.push({
          file,
          path: evaluatorPath,
          uid: currentUid,
          message: `evaluator \`type\` is ${evaluator.type === null ? 'null' : typeof evaluator.type}, expected a string`,
        });
      } else {
        findings.push({ file, path: evaluatorPath, uid: currentUid, modelType: currentModel, type: evaluator.type });
      }
    }

    for (const [key, value] of Object.entries(record)) {
      walk(value, path ? `${path}.${key}` : key, currentUid, currentModel);
    }
  }

  walk(root, basePath, NO_UID, 'unknown');
  return { findings, problems };
}

/** Findings whose evaluator type the enclosing expression model does not accept. */
export function invalidFindings (findings: readonly EvaluatorFinding[]): EvaluatorFinding[] {
  return findings.filter((f) => !supportedFor(f.modelType).includes(f.type));
}
