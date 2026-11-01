/**
 * The thin Grafana rules for the alerts the car app computes itself (#1881).
 *
 * ioniq-app-alerts.yaml must hold one `<uid>-app` rule for every rule in the
 * other ioniq-*-alerts.yaml files (except ioniq-tpms-coldstart-stale), with
 * the same labels, title and annotations, reading only the app's message
 * `group='alerts/<uid>'`. During the side-by-side run the label
 * side_by_side=true sends them to the silent receiver, muted all the time.
 */
import { describe, expect, it } from '@jest/globals';
import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { load as parseYaml } from 'js-yaml';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const ALERTING = path.join(REPO_ROOT, 'config/grafana/provisioning/alerting');
const APP_FILE = 'ioniq-app-alerts.yaml';
const NOT_FROM_APP = new Set(['ioniq-tpms-coldstart-stale']);

function load (file: string): any {
  return parseYaml(readFileSync(path.join(ALERTING, file), 'utf8'));
}

function rules (file: string): any[] {
  return (load(file).groups ?? []).flatMap((g: any) => g.rules ?? []);
}

const originals = readdirSync(ALERTING)
  .filter((f) => /^ioniq-.*-alerts\.yaml$/.test(f) && f !== APP_FILE)
  .flatMap(rules)
  .filter((r) => !NOT_FROM_APP.has(r.uid));
const appRules = rules(APP_FILE);
const appByUid = new Map(appRules.map((r) => [r.uid, r]));

describe(APP_FILE, () => {
  it('has exactly one <uid>-app rule per original rule, and no others', () => {
    expect(originals.length).toBeGreaterThan(0);
    expect(appRules.map((r) => r.uid).sort()).toEqual(originals.map((r) => `${r.uid}-app`).sort());
  });

  describe.each(originals.map((o) => [o.uid, o]))('%s', (uid, original) => {
    const app = appByUid.get(`${uid}-app`);

    it('copies labels (plus side_by_side), title and annotations', () => {
      expect(app.labels).toEqual({ ...original.labels, side_by_side: 'true' });
      expect(app.title).toBe(original.title);
      expect(app.annotations).toEqual(original.annotations);
    });

    it('fires at once and stays OK without data or on error', () => {
      expect(app.for).toBe('0s');
      expect(app.noDataState).toBe('OK');
      expect(app.execErrState).toBe('OK');
    });

    it('reads last("firing") of the app message over 30 days, fires on > 0', () => {
      expect(app.data.map((d: any) => d.refId)).toEqual(['firing', 'A']);
      const [firing, condition] = app.data;
      expect(firing.relativeTimeRange.from).toBe(2592000);
      expect(firing.model.query).toMatch(/last\("firing"\)/);
      expect(firing.model.query).toContain(`"group"='alerts/${uid}'`);
      expect(firing.model.query).toContain('now() - 30d');
      expect(app.condition).toBe('A');
      expect(condition.datasourceUid).toBe('__expr__');
      expect(condition.model.conditions).toEqual([expect.objectContaining({
        evaluator: { type: 'gt', params: [0] },
        query: { params: ['firing'] },
        reducer: { type: 'last' },
      })]);
    });
  });
});

describe('silent route for the side-by-side run', () => {
  const policies = load('notification-policies.yaml');

  it('is the first route: side_by_side=true to silent, muted by "always"', () => {
    const first = policies.policies[0].routes[0];
    expect(first.matchers).toEqual(['side_by_side = true']);
    expect(first.receiver).toBe('silent');
    expect(first.mute_time_intervals).toEqual(['always']);
  });

  it('mute timing "always" covers every day with no time limits', () => {
    const always = policies.muteTimes.find((m: any) => m.name === 'always');
    expect(always.time_intervals).toEqual([{ weekdays: ['sunday:saturday'] }]);
  });

  it('contact point "silent" exists', () => {
    const names = load('contact-points.yaml').contactPoints.map((c: any) => c.name);
    expect(names).toContain('silent');
  });
});
