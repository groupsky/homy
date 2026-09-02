import { existsSync, readFileSync } from 'fs';
import type { RunResult } from './report.js';
import { DERIVED_FROM_GRAFANA, SI_SCALING_UNITS } from './units.js';

const RULE = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * The Grafana tag `docker/grafana/Dockerfile` builds on.
 *
 * That Dockerfile is the pin, not docker-compose.yml: compose refers to the
 * built image as `ghcr.io/groupsky/homy/grafana:${IMAGE_TAG:-latest}`, so the
 * only place the upstream Grafana version appears is this `FROM`.
 *
 * Returns null when no such line is present.
 */
export function grafanaBaseTag (dockerfile: string): string | null {
  const match = /^\s*FROM\s+ghcr\.io\/groupsky\/homy\/grafana:(\S+)/mi.exec(readFileSync(dockerfile, 'utf8'));
  return match ? match[1] : null;
}

/**
 * Fails when the deployed Grafana version has moved away from the one
 * `SI_SCALING_UNITS` was derived from.
 *
 * The unit list is data read out of one image's source maps. A Grafana bump can
 * add a unit, rename one, or change a formatter, and none of that shows up in
 * any test - the list would simply be quietly describing a version that is no
 * longer running. Before this check the only thing tying the two together was a
 * sentence in the README.
 */
export function runGrafanaVersionPin (dockerfile: string): RunResult {
  const out: string[] = [];
  const err: string[] = [];

  if (!existsSync(dockerfile)) {
    err.push(`❌ Grafana Dockerfile not found: ${dockerfile}`, '   SI_SCALING_UNITS cannot be checked against the deployed version.');
    return { code: 1, out, err };
  }

  const tag = grafanaBaseTag(dockerfile);
  if (tag === null) {
    err.push(
      RULE,
      `❌ No \`FROM ghcr.io/groupsky/homy/grafana:<tag>\` line in ${dockerfile}`,
      '',
      'That line is where the deployed Grafana version is pinned, and it is what',
      `SI_SCALING_UNITS (derived from ${DERIVED_FROM_GRAFANA}) is checked against.`,
      RULE
    );
    return { code: 1, out, err };
  }

  if (tag !== DERIVED_FROM_GRAFANA) {
    err.push(
      RULE,
      `❌ Grafana was bumped to ${tag}, but SI_SCALING_UNITS was derived from ${DERIVED_FROM_GRAFANA}.`,
      '',
      `The ${SI_SCALING_UNITS.size} unit ids in src/lib/units.ts are data read out of one`,
      'image. A version bump can add a unit, rename one, or change which formatter',
      'a unit uses, and nothing else here would notice.',
      '',
      'Re-derive the list, then update DERIVED_FROM_GRAFANA:',
      '',
      `  id=$(docker create ghcr.io/groupsky/homy/grafana:${tag} true)`,
      '  docker cp "$id:/usr/share/grafana/public/build" ./gbuild && docker rm "$id"',
      '  # the source map carrying valueFormats/categories.ts holds the original source',
      '  grep -l valueFormats/categories.ts gbuild/*.js.map',
      '',
      'Take every `{ name: ..., id: \'x\', fn: SIPrefix(...) }` entry as an id, and',
      'refresh tests/lib/grafana-value-format.ts from the same source maps.',
      '',
      'See .github/scripts/validate-grafana-alerts/README.md, "Why - dashboard units".',
      RULE
    );
    return { code: 1, out, err };
  }

  out.push(`✅ SI_SCALING_UNITS was derived from Grafana ${DERIVED_FROM_GRAFANA}, which is what ${dockerfile} pins.`);
  return { code: 0, out, err };
}
