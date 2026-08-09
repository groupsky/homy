/**
 * The expression model an evaluator belongs to.
 *
 * Grafana applies a different evaluator set per expression type, so the walk
 * has to know which one encloses each `evaluator` it finds. `unknown` means no
 * enclosing `type: classic_conditions` / `type: threshold` was seen.
 */
export type ModelType = 'classic_conditions' | 'threshold' | 'unknown';

/** One `evaluator.type` successfully resolved from a provisioning file. */
export interface EvaluatorFinding {
  /** File the evaluator was read from. */
  file: string;
  /** Location within the document, e.g. `groups[0].rules[2].data[1].model.conditions[0]`. */
  path: string;
  /** Nearest enclosing rule `uid`, or a placeholder when the rule has none. */
  uid: string;
  /** Expression model enclosing this evaluator. */
  modelType: ModelType;
  /** The evaluator type exactly as written - never normalised, Grafana compares case-sensitively. */
  type: string;
}

/**
 * Something that prevented an evaluator from being resolved.
 *
 * Every problem fails the run. An evaluator this tool cannot read is an
 * evaluator it cannot vouch for, and silently passing it is the failure mode
 * this check exists to prevent.
 */
export interface EvaluatorProblem {
  file: string;
  path: string;
  uid: string;
  message: string;
}

export interface ScanResult {
  findings: EvaluatorFinding[];
  problems: EvaluatorProblem[];
}
