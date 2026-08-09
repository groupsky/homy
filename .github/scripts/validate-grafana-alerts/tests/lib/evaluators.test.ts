import { describe, expect, it } from '@jest/globals';
import { load } from 'js-yaml';
import {
  collectEvaluators,
  invalidFindings,
  NO_UID,
  supportedFor,
  CLASSIC_EVALUATORS,
  THRESHOLD_EVALUATORS,
} from '../../src/lib/evaluators.js';

/** Parses YAML and resolves every evaluator in it, as the checker does. */
function scan (yaml: string) {
  return collectEvaluators(load(yaml), 'fixture.yaml');
}

/** The evaluator types the checker would reject in `yaml`. */
function rejected (yaml: string): string[] {
  return invalidFindings(scan(yaml).findings).map((f) => f.type);
}

describe('collectEvaluators - YAML spellings that defeated the previous line scanner', () => {
  // Each of these is valid YAML that Grafana provisions, and each made the
  // regex-based checker report "0 evaluator(s)" and exit 0.

  it('finds an evaluator whose key is preceded by `{` rather than whitespace', () => {
    // The old `(^|\s)evaluator:` required a line start or a space before the key.
    const yaml = `
groups:
  - rules:
      - uid: s1-rule
        data:
          - model:
              type: classic_conditions
              conditions:
                - {evaluator: {type: gte, params: [1]}, operator: {type: and}, type: query}
`;
    expect(rejected(yaml)).toEqual(['gte']);
  });

  it('finds every evaluator when several share one line', () => {
    // The old scanner counted one `evaluator:` per line, stopped its capture at
    // the first `}`, and returned after the first match - so a good evaluator
    // in front of a bad one hid it AND kept the declared/found self-check happy.
    const yaml = `
groups:
  - rules:
      - uid: s2-rule
        data:
          - model:
              type: classic_conditions
              conditions: [ { evaluator: {type: lt, params: [1]}, type: query }, { evaluator: {type: gte, params: [1]}, type: query } ]
`;
    const { findings } = scan(yaml);
    expect(findings.map((f) => f.type)).toEqual(['lt', 'gte']);
    expect(rejected(yaml)).toEqual(['gte']);
  });

  it('finds an evaluator declared with a quoted key', () => {
    const yaml = `
groups:
  - rules:
      - uid: s5-rule
        data:
          - model:
              type: classic_conditions
              conditions:
                - "evaluator":
                    params: [1]
                    type: gte
`;
    expect(rejected(yaml)).toEqual(['gte']);
  });
});

describe('collectEvaluators - the styles already committed in this repository', () => {
  it('reads the block style', () => {
    const yaml = `
groups:
  - rules:
      - uid: block-rule
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator:
                    params: [85]
                    type: gt
                  operator:
                    type: and
                  reducer:
                    type: last
                  type: query
`;
    const { findings } = scan(yaml);
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ type: 'gt', uid: 'block-rule', modelType: 'classic_conditions' });
  });

  it('reads the single-line flow style', () => {
    const yaml = `
groups:
  - rules:
      - uid: flow-rule
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lt, params: [30] }
                  operator: { type: and }
                  reducer: { type: last }
                  type: query
`;
    expect(scan(yaml).findings.map((f) => f.type)).toEqual(['lt']);
  });

  it('reads a flow mapping split across lines', () => {
    const yaml = `
groups:
  - rules:
      - uid: multiline-flow
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: {
                    type: gte,
                    params: [1]
                  }
`;
    expect(rejected(yaml)).toEqual(['gte']);
  });

  it('does not confuse the surrounding operator, reducer and condition `type` keys with the evaluator', () => {
    const yaml = `
groups:
  - rules:
      - uid: siblings
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator:
                    params: [0]
                    type: gt
                  operator:
                    type: and
                  reducer:
                    type: last
                  type: query
`;
    expect(scan(yaml).findings.map((f) => f.type)).toEqual(['gt']);
  });
});

describe('collectEvaluators - parser-resolved YAML features', () => {
  it('sees an evaluator inherited through a merge key', () => {
    const yaml = `
base: &base
  evaluator: {type: gte, params: [1]}
groups:
  - rules:
      - uid: merged
        data:
          - model:
              type: classic_conditions
              conditions:
                - <<: *base
                  type: query
`;
    expect(rejected(yaml)).toContain('gte');
  });

  it('sees an evaluator reached through an alias', () => {
    const yaml = `
anchors:
  bad: &bad {type: lte, params: [1]}
groups:
  - rules:
      - uid: aliased
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: *bad
`;
    expect(rejected(yaml)).toEqual(['lte']);
  });

  it('terminates on a self-referential anchor instead of recursing forever', () => {
    // `a: &x [*x]` parses to an array that contains itself.
    const cyclic = load('a: &x [*x]\n');
    expect(() => collectEvaluators(cyclic, 'fixture.yaml')).not.toThrow();
  });

  it('ignores comments, including ones that mention gte', () => {
    const yaml = `
groups:
  - rules:
      # do not use gte here - see issue #1475
      - uid: commented
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gt, params: [0] }  # gte 1 is gt 0
`;
    expect(scan(yaml).findings.map((f) => f.type)).toEqual(['gt']);
    expect(rejected(yaml)).toEqual([]);
  });
});

describe('collectEvaluators - case sensitivity', () => {
  it('rejects an upper-case type, because Grafana compares case-sensitively', () => {
    const yaml = `
groups:
  - rules:
      - uid: shouty
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: { type: GT, params: [0] }
`;
    expect(rejected(yaml)).toEqual(['GT']);
  });

  it('rejects an upper-case GTE', () => {
    const yaml = 'conditions:\n  - evaluator: { type: GTE, params: [1] }\n';
    expect(rejected(yaml)).toEqual(['GTE']);
  });
});

describe('collectEvaluators - fail closed on unreadable evaluators', () => {
  it('reports an evaluator with no type', () => {
    const { findings, problems } = scan('conditions:\n  - evaluator: { params: [1] }\n');
    expect(findings).toHaveLength(0);
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('no `type`');
  });

  it('reports an evaluator that is not a mapping', () => {
    const { problems } = scan('conditions:\n  - evaluator: gte\n');
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain('expected a mapping');
  });

  it('reports an evaluator that is a sequence', () => {
    const { problems } = scan('conditions:\n  - evaluator: [gt, 0]\n');
    expect(problems[0].message).toContain('a sequence');
  });

  it('reports an evaluator that is null', () => {
    const { problems } = scan('conditions:\n  - evaluator:\n');
    expect(problems[0].message).toContain('null');
  });

  it('reports a non-string type', () => {
    const { problems } = scan('conditions:\n  - evaluator: { type: 1, params: [1] }\n');
    expect(problems[0].message).toContain('expected a string');
  });
});

describe('collectEvaluators - context', () => {
  it('attributes each evaluator to its nearest enclosing rule uid', () => {
    const yaml = `
groups:
  - rules:
      - uid: first
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gte, params: [1] }
      - uid: second
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: { type: lte, params: [1] }
`;
    const bad = invalidFindings(scan(yaml).findings);
    expect(bad.map((f) => [f.uid, f.type])).toEqual([['first', 'gte'], ['second', 'lte']]);
  });

  it('falls back to a placeholder uid when the rule has none', () => {
    const { findings } = scan('conditions:\n  - evaluator: { type: gt, params: [0] }\n');
    expect(findings[0].uid).toBe(NO_UID);
  });

  it('records a path that locates the evaluator in the document', () => {
    const yaml = `
groups:
  - rules:
      - uid: pathed
        data:
          - model:
              type: classic_conditions
              conditions:
                - evaluator: { type: gte, params: [1] }
`;
    expect(scan(yaml).findings[0].path).toBe('groups[0].rules[0].data[0].model.conditions[0].evaluator');
  });
});

describe('supported evaluator sets differ by expression type', () => {
  it('accepts no_value inside classic_conditions', () => {
    const yaml = `
data:
  - model:
      type: classic_conditions
      conditions:
        - evaluator: { type: no_value, params: [] }
`;
    expect(rejected(yaml)).toEqual([]);
  });

  it('rejects no_value inside a threshold expression', () => {
    // Grafana 9.5.21 pkg/expr/threshold.go supportedThresholdFuncs omits no_value.
    const yaml = `
data:
  - model:
      type: threshold
      conditions:
        - evaluator: { type: no_value, params: [] }
`;
    const bad = invalidFindings(scan(yaml).findings);
    expect(bad.map((f) => [f.modelType, f.type])).toEqual([['threshold', 'no_value']]);
  });

  it('accepts gt inside a threshold expression', () => {
    const yaml = `
data:
  - model:
      type: threshold
      conditions:
        - evaluator: { type: gt, params: [0] }
`;
    expect(rejected(yaml)).toEqual([]);
  });

  it('assumes the classic set when no enclosing model type is present', () => {
    const { findings } = scan('conditions:\n  - evaluator: { type: no_value, params: [] }\n');
    expect(findings[0].modelType).toBe('unknown');
    expect(supportedFor('unknown')).toEqual(CLASSIC_EVALUATORS);
  });

  it('exposes the two source-derived evaluator sets', () => {
    expect(CLASSIC_EVALUATORS).toEqual(['gt', 'lt', 'within_range', 'outside_range', 'no_value']);
    expect(THRESHOLD_EVALUATORS).toEqual(['gt', 'lt', 'within_range', 'outside_range']);
  });
});
