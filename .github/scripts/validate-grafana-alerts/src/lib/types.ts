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

/** One `unit` resolved from a provisioned dashboard. */
export interface UnitFinding {
  /** Dashboard path relative to the dashboards directory, `/`-separated. */
  file: string;
  /** Location within the document, e.g. `panels[3].fieldConfig.defaults.unit`. */
  path: string;
  /** `id` of the panel the unit belongs to. */
  panelId: number;
  /** Panel `title`, or a placeholder when the panel has none. */
  panelTitle: string;
  /** The unit id exactly as written - Grafana looks it up case-sensitively. */
  unit: string;
  /**
   * Numeric steps of the panel's `fieldConfig.defaults.thresholds`.
   *
   * A threshold is written in the panel's base unit, so a step below 1 is
   * direct evidence that the series lives where an SI-prefixed unit rescales.
   * Taken from the panel defaults even for a unit set through an override -
   * approximate on purpose, and only ever used to refuse an exception.
   */
  thresholds: number[];
}

/**
 * Something that stopped a unit from being attributed to a panel.
 *
 * Every problem fails the run, for the same reason an unreadable evaluator
 * does: a unit this tool cannot place is a unit it cannot vouch for.
 */
export interface UnitProblem {
  file: string;
  path: string;
  message: string;
}

export interface UnitScanResult {
  findings: UnitFinding[];
  problems: UnitProblem[];
}
