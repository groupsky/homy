/**
 * Integration test for the deploy contract behind issue #1544.
 *
 * `deploy.sh` exports `IMAGE_TAG="$NEW_VERSION"` (the full commit SHA) and every
 * service in the real `docker-compose.yml` resolves `${IMAGE_TAG:-latest}`, so a
 * default deploy needs a SHA-tagged image for EVERY compose service. The unit
 * tests for `servicesNeedingShaTag` feed it hand-written arrays, which proves the
 * set arithmetic but not the thing that actually broke: that `allServices` really
 * is every compose service.
 *
 * These tests read the committed `docker-compose.yml` instead, so a service added
 * to the stack — or one that stops satisfying the detector's discovery filter —
 * fails here rather than at `docker compose pull` time on routy.
 */

import { describe, test, expect } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as yaml from 'js-yaml';
import { servicesNeedingShaTag, imageNamesNeedingShaTag } from '../../src/lib/build-strategy.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '../../../../..');
const composeFile = path.join(repoRoot, 'docker-compose.yml');

const HOMY_PREFIX = 'ghcr.io/groupsky/homy/';

interface ComposeService {
  image?: string;
  build?: unknown;
}

/**
 * Read the compose file directly rather than via `discoverServicesFromCompose`.
 *
 * That function shells out to `docker compose config` and, more importantly,
 * applies the very filter under test (`extractServiceMetadata` returns null for a
 * service with no `build:` directive). Reading the YAML is the independent
 * measurement: it is the same file `deploy.sh` runs `docker compose pull` against.
 */
function readComposeServices(): Record<string, ComposeService> {
  const raw = fs.readFileSync(composeFile, 'utf-8');
  const parsed = yaml.load(raw) as { services?: Record<string, ComposeService> };
  return parsed.services ?? {};
}

/** Compose services pinned to a homy GHCR image, i.e. the ones a deploy must pull. */
function deployableServices(): Record<string, ComposeService> {
  return Object.fromEntries(
    Object.entries(readComposeServices()).filter(([, config]) =>
      (config.image ?? '').startsWith(HOMY_PREFIX)
    )
  );
}

/** GHCR image name (basename, tag stripped) for a compose image field. */
function imageNameOf(image: string): string {
  return image.slice(HOMY_PREFIX.length).split(':')[0]!;
}

describe('SHA tag coverage of the real docker-compose.yml', () => {
  test('every homy-image service also has a build directive', () => {
    // The detector discovers services via `extractServiceMetadata`, which returns
    // null without a `build:` directive. A service reusing a prebuilt GHCR image
    // would therefore drop out of BOTH `to_build` and `to_retag` while still being
    // pulled at the SHA by a deploy. If this ever fails, the fix is not to relax
    // this test - it is to give stage 5B a source for that service's manifest.
    const withoutBuild = Object.entries(deployableServices())
      .filter(([, config]) => !config.build)
      .map(([name]) => name);

    expect(withoutBuild).toEqual([]);
  });

  test('every homy-image service pins ${IMAGE_TAG}', () => {
    // The contract only holds for services whose tag actually follows IMAGE_TAG.
    const unpinned = Object.entries(deployableServices())
      .filter(([, config]) => !config.image!.includes('${IMAGE_TAG'))
      .map(([name]) => name);

    expect(unpinned).toEqual([]);
  });

  test('to_build union to_retag covers every compose service, whatever is built', () => {
    const allServices = Object.keys(deployableServices()).sort();
    expect(allServices.length).toBeGreaterThan(0);

    // Exhaustive over the shapes a real run takes: nothing built (a docs-only
    // master push), everything built (force_rebuild), and every single-service
    // and leave-one-out build set in between.
    const buildSets: string[][] = [[], allServices];
    for (const service of allServices) {
      buildSets.push([service]);
      buildSets.push(allServices.filter((s) => s !== service));
    }

    for (const toBuild of buildSets) {
      const toRetag = servicesNeedingShaTag({ allServices, toBuild });
      const covered = Array.from(new Set([...toBuild, ...toRetag])).sort();

      expect(covered).toEqual(allServices);
      // No service may be in both: stage 5A and stage 5B run in parallel.
      expect(toRetag.filter((s) => toBuild.includes(s))).toEqual([]);
    }
  });

  test('retag image names never collide with an image stage 5A is building', () => {
    const services = deployableServices();
    const allServices = Object.keys(services).sort();
    const serviceImageNames = Object.fromEntries(
      Object.entries(services).map(([name, config]) => [name, imageNameOf(config.image!)])
    );

    for (const service of allServices) {
      const toBuild = [service];
      const toRetag = servicesNeedingShaTag({ allServices, toBuild });
      const retagImages = imageNamesNeedingShaTag({ serviceImageNames, toRetag, toBuild });

      // Building one of the five modbus-serial services must keep stage 5B off
      // the shared `modbus-serial` image, even though the other four are in
      // to_retag - both jobs would otherwise write `modbus-serial:<sha>`.
      expect(retagImages).not.toContain(serviceImageNames[service]);

      // Together the two stages still cover every distinct image.
      const builtImages = new Set(toBuild.map((s) => serviceImageNames[s]!));
      const covered = new Set([...builtImages, ...retagImages]);
      const expected = new Set(Object.values(serviceImageNames));
      expect(Array.from(covered).sort()).toEqual(Array.from(expected).sort());
    }
  });

  test('services sharing a GHCR image collapse to one retag job', () => {
    const services = deployableServices();
    const allServices = Object.keys(services).sort();
    const serviceImageNames = Object.fromEntries(
      Object.entries(services).map(([name, config]) => [name, imageNameOf(config.image!)])
    );

    const toRetag = servicesNeedingShaTag({ allServices, toBuild: [] });
    const retagImages = imageNamesNeedingShaTag({ serviceImageNames, toRetag, toBuild: [] });
    const distinctImages = new Set(Object.values(serviceImageNames));

    expect(retagImages.length).toBe(distinctImages.size);
    expect(retagImages.length).toBeLessThan(allServices.length);
  });
});
