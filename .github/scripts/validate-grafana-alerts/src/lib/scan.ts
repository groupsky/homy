import { readdirSync, readFileSync } from 'fs';
import * as path from 'path';
import { loadAll } from 'js-yaml';
import { collectEvaluators } from './evaluators.js';
import type { ScanResult } from './types.js';

/**
 * Extensions Grafana's alerting provisioner reads.
 *
 * Grafana 9.5.21, `pkg/services/provisioning/alerting/config_reader.go`, which
 * rejects anything else with "file has invalid suffix '%s' (.yaml,.yml,.json
 * accepted), skipping". `.json` is easy to forget and is a real hole: the
 * workflow's path filter fires on it, so a `.json` rule the checker skipped
 * would turn CI green on a file it never opened.
 */
export const PROVISIONED_EXTENSIONS = ['.yaml', '.yml', '.json'];

/** Provisioning files in `dir`, sorted, that Grafana would actually load. */
export function listProvisioningFiles (dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => PROVISIONED_EXTENSIONS.includes(path.extname(name).toLowerCase()))
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * Parses one provisioning file and resolves every evaluator in it.
 *
 * `.json` is parsed with the YAML loader too: YAML is a superset of JSON, so
 * this accepts everything a JSON parser would and does not need a second code
 * path. `loadAll` covers multi-document YAML - a second document is as
 * provisioned as the first and must not be skipped.
 *
 * A file that cannot be parsed is reported as a problem rather than thrown, so
 * one broken file still produces a full report of the rest.
 */
export function scanFile (file: string): ScanResult {
  let documents: unknown[];
  try {
    documents = loadAll(readFileSync(file, 'utf8'));
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    return { findings: [], problems: [{ file, path: '(file)', uid: '(unparsed)', message: `cannot be parsed: ${message}` }] };
  }

  const findings: ScanResult['findings'] = [];
  const problems: ScanResult['problems'] = [];
  documents.forEach((document, i) => {
    const basePath = documents.length > 1 ? `doc[${i}]` : '';
    const result = collectEvaluators(document, file, basePath);
    findings.push(...result.findings);
    problems.push(...result.problems);
  });
  return { findings, problems };
}

/** Resolves every evaluator across every provisioning file in `dir`. */
export function scanDirectory (dir: string): ScanResult {
  const findings: ScanResult['findings'] = [];
  const problems: ScanResult['problems'] = [];
  for (const file of listProvisioningFiles(dir)) {
    const result = scanFile(file);
    findings.push(...result.findings);
    problems.push(...result.problems);
  }
  return { findings, problems };
}
