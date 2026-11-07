/**
 * The thin Grafana rules for the alerts the car app computes itself (#1881).
 *
 * ioniq-app-alerts.yaml must hold one `<uid>-app` rule for every rule in the
 * other ioniq-*-alerts.yaml files (except ioniq-tpms-coldstart-stale), with
 * the same labels, title and description, reading only the app's message
 * `group='alerts/<uid>'`, plus rules for alerts only the app has
 * (ioniq-soh-rise). The summary is the app's text, from tag alert_summary
 * (#1914). During the side-by-side run the label
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
// Alerts only the app has: no yaml rule to copy.
const APP_ONLY = [
  { uid: 'ioniq-soh-rise', labels: { severity: 'info', device: 'ioniq', subsystem: 'battery' } },
];

// The summary annotation: the app's text from the label, else the fallback.
function appSummary (fallback: string): string {
  return `{{ if $labels.alert_summary }}{{ $labels.alert_summary }}{{ else }}${fallback}{{ end }}`;
}

// The data of every thin rule: last firing_at per app text, and the newest
// firing_at over all texts; fires for the text of the newest message.
function expectAppQuery (app: any, uid: string): void {
  expect(app.data.map((d: any) => d.refId)).toEqual(['firing', 'latest', 'firing_last', 'latest_last', 'A']);
  const [firing, latest, firingLast, latestLast, condition] = app.data;
  for (const q of [firing, latest]) {
    expect(q.relativeTimeRange.from).toBe(2592000);
    expect(q.model.query).toMatch(/last\("firing_at"\)/);
    expect(q.model.query).toContain(`"group"='alerts/${uid}'`);
    expect(q.model.query).toContain('now() - 30d');
  }
  expect(firing.model.query).toContain('GROUP BY "alert_summary"');
  expect(latest.model.query).not.toContain('GROUP BY');
  expect(firingLast.model).toMatchObject({ type: 'reduce', expression: 'firing', reducer: 'last' });
  expect(latestLast.model).toMatchObject({ type: 'reduce', expression: 'latest', reducer: 'last' });
  expect(app.condition).toBe('A');
  expect(condition.model).toMatchObject({ type: 'math', expression: '$firing_last > 0 && $firing_last == $latest_last' });
}

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
    expect(appRules.map((r) => r.uid).sort()).toEqual(
      [...originals.map((r) => r.uid), ...APP_ONLY.map((r) => r.uid)].map((u) => `${u}-app`).sort(),
    );
  });

  describe.each(originals.map((o) => [o.uid, o]))('%s', (uid, original) => {
    const app = appByUid.get(`${uid}-app`);

    it('copies labels (plus side_by_side), title and annotations; summary is the app text', () => {
      expect(app.labels).toEqual({ ...original.labels, side_by_side: 'true' });
      expect(app.title).toBe(original.title);
      expect(app.annotations).toEqual({ ...original.annotations, summary: appSummary(original.annotations.summary) });
    });

    it('fires at once and stays OK without data or on error', () => {
      expect(app.for).toBe('0s');
      expect(app.noDataState).toBe('OK');
      expect(app.execErrState).toBe('OK');
    });

    it('reads the app message over 30 days, one instance per app text', () => {
      expectAppQuery(app, uid);
    });
  });
});

describe.each(APP_ONLY)('$uid (only from the app)', ({ uid, labels }) => {
  const app = appByUid.get(`${uid}-app`);

  it('has its labels (plus side_by_side), the app text as summary, and the same query', () => {
    expect(app.labels).toEqual({ ...labels, side_by_side: 'true' });
    expect(app.annotations.summary).toMatch(/^\{\{ if \$labels\.alert_summary \}\}\{\{ \$labels\.alert_summary \}\}\{\{ else \}\}.+\{\{ end \}\}$/);
    expect(app).toMatchObject({ for: '0s', noDataState: 'OK', execErrState: 'OK' });
    expectAppQuery(app, uid);
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
