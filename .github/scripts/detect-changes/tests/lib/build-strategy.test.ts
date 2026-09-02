/**
 * Test suite for build-strategy module.
 *
 * Encodes the retag-vs-build eligibility rule that guards against shipping a
 * STALE image for a service whose own source changed:
 *
 *   - A directly-changed service whose changes are NOT test-only must ALWAYS
 *     build. It must never be retag-eligible, regardless of whether a base-SHA
 *     image already exists in GHCR.
 *   - Retag-eligible services are: affected services (pulled in by a base-image
 *     change, own source unchanged) and changed services whose changes are
 *     test-only (preserving the test-only optimization).
 */

import { describe, test, expect } from '@jest/globals';
import {
  imageNamesNeedingShaTag,
  partitionBuildStrategy,
  servicesNeedingShaTag,
} from '../../src/lib/build-strategy.js';

describe('partitionBuildStrategy', () => {
  test('directly-changed non-test service is force-built and NOT retag-eligible', () => {
    const result = partitionBuildStrategy({
      changedServices: ['automations'],
      affectedServices: [],
      isTestOnly: () => false,
    });

    // The core bug fix: a changed non-test service must build, never retag.
    expect(result.mustBuild).toEqual(['automations']);
    expect(result.retagEligible).toEqual([]);
  });

  test('changed test-only service stays retag-eligible (test-only optimization preserved)', () => {
    const result = partitionBuildStrategy({
      changedServices: ['automations'],
      affectedServices: [],
      isTestOnly: (name) => name === 'automations',
    });

    expect(result.mustBuild).toEqual([]);
    expect(result.retagEligible).toEqual(['automations']);
  });

  test('affected service (own source unchanged) stays retag-eligible', () => {
    const result = partitionBuildStrategy({
      changedServices: [],
      affectedServices: ['features'],
      isTestOnly: () => false,
    });

    expect(result.mustBuild).toEqual([]);
    expect(result.retagEligible).toEqual(['features']);
  });

  test('service that is both changed non-test-only AND affected must build (not retag)', () => {
    const result = partitionBuildStrategy({
      changedServices: ['automations'],
      affectedServices: ['automations'],
      isTestOnly: () => false,
    });

    expect(result.mustBuild).toEqual(['automations']);
    expect(result.retagEligible).toEqual([]);
  });

  test('mixed set partitions correctly', () => {
    // automations: changed, production code -> must build
    // features: changed, test-only -> retag eligible
    // ha_discovery: affected only -> retag eligible
    const result = partitionBuildStrategy({
      changedServices: ['automations', 'features'],
      affectedServices: ['ha_discovery'],
      isTestOnly: (name) => name === 'features',
    });

    expect(result.mustBuild).toEqual(['automations']);
    expect(result.retagEligible.sort()).toEqual(['features', 'ha_discovery']);
  });

  test('retagEligible never overlaps mustBuild', () => {
    const result = partitionBuildStrategy({
      changedServices: ['a', 'b', 'c'],
      affectedServices: ['b', 'd'],
      isTestOnly: (name) => name === 'b',
    });

    const overlap = result.retagEligible.filter((s) => result.mustBuild.includes(s));
    expect(overlap).toEqual([]);
    // a, c changed non-test -> build; b test-only -> retag; d affected -> retag
    expect(result.mustBuild.sort()).toEqual(['a', 'c']);
    expect(result.retagEligible.sort()).toEqual(['b', 'd']);
  });

  test('empty input yields empty partitions', () => {
    const result = partitionBuildStrategy({
      changedServices: [],
      affectedServices: [],
      isTestOnly: () => false,
    });

    expect(result.mustBuild).toEqual([]);
    expect(result.retagEligible).toEqual([]);
  });
});

describe('servicesNeedingShaTag', () => {
  // deploy.sh pins IMAGE_TAG to the commit SHA for EVERY service in
  // docker-compose.yml, so every service needs an image at that tag - not just
  // the ones this run rebuilt. Before issue #1544 the retag list only ever held
  // changed/affected services, so on a typical commit ~28 unchanged services got
  // no SHA tag and a default deploy died on `manifest unknown`.
  test('lists every service that is not being rebuilt', () => {
    const result = servicesNeedingShaTag({
      allServices: ['automations', 'dmx-driver', 'grafana', 'ha', 'mqtt-mongo-history'],
      toBuild: ['dmx-driver', 'mqtt-mongo-history'],
    });

    expect(result).toEqual(['automations', 'grafana', 'ha']);
  });

  test('returns every service when nothing is rebuilt', () => {
    expect(
      servicesNeedingShaTag({ allServices: ['automations', 'grafana'], toBuild: [] })
    ).toEqual(['automations', 'grafana']);
  });

  test('returns nothing when every service is rebuilt', () => {
    expect(
      servicesNeedingShaTag({ allServices: ['automations'], toBuild: ['automations'] })
    ).toEqual([]);
  });

  test('is sorted and free of duplicates so the CI matrix is stable', () => {
    const result = servicesNeedingShaTag({
      allServices: ['zigbee', 'automations', 'zigbee', 'grafana'],
      toBuild: [],
    });

    expect(result).toEqual(['automations', 'grafana', 'zigbee']);
  });

  test('ignores a service listed in toBuild that is not a compose service', () => {
    expect(
      servicesNeedingShaTag({ allServices: ['automations'], toBuild: ['ghost-service'] })
    ).toEqual(['automations']);
  });
});

describe('imageNamesNeedingShaTag', () => {
  // Stage 5B writes tags on IMAGE names while its matrix used to be SERVICE
  // names. Five modbus-serial services share one image, so a run that rebuilt
  // one of them had stage 5A and stage 5B writing `modbus-serial:<sha>` in
  // parallel, and spawned four redundant runners to do it.
  const serviceImageNames = {
    'modbus-serial-monitoring': 'modbus-serial',
    'modbus-serial-monitoring2': 'modbus-serial',
    'modbus-serial-dry-switches': 'modbus-serial',
    'mqtt-mongo-history': 'mqtt-mongo',
    'mqtt-mongo-ioniq': 'mqtt-mongo',
    automations: 'automations',
    grafana: 'grafana',
  };

  test('collapses services sharing an image to a single entry', () => {
    const result = imageNamesNeedingShaTag({
      serviceImageNames,
      toRetag: Object.keys(serviceImageNames).sort(),
      toBuild: [],
    });

    expect(result).toEqual(['automations', 'grafana', 'modbus-serial', 'mqtt-mongo']);
  });

  test('drops an image that stage 5A is already tagging via a sibling service', () => {
    // monitoring2 and dry-switches are in to_retag, but their image is being
    // built for monitoring. Retagging it would race stage 5A on the same tag.
    const result = imageNamesNeedingShaTag({
      serviceImageNames,
      toRetag: ['modbus-serial-monitoring2', 'modbus-serial-dry-switches', 'grafana'],
      toBuild: ['modbus-serial-monitoring'],
    });

    expect(result).toEqual(['grafana']);
  });

  test('returns nothing when every retagged image is also being built', () => {
    expect(
      imageNamesNeedingShaTag({
        serviceImageNames,
        toRetag: ['mqtt-mongo-ioniq'],
        toBuild: ['mqtt-mongo-history'],
      })
    ).toEqual([]);
  });

  test('falls back to the service name when it has no mapped image', () => {
    // getImageName already falls back to the service name for a non-homy image;
    // an absent key must not become the string "undefined" in a docker tag.
    expect(
      imageNamesNeedingShaTag({ serviceImageNames: {}, toRetag: ['ha'], toBuild: [] })
    ).toEqual(['ha']);
  });

  test('is sorted so the CI matrix is stable across runs', () => {
    const result = imageNamesNeedingShaTag({
      serviceImageNames: { c: 'zeta', a: 'alpha', b: 'mid' },
      toRetag: ['c', 'a', 'b'],
      toBuild: [],
    });

    expect(result).toEqual(['alpha', 'mid', 'zeta']);
  });
});
