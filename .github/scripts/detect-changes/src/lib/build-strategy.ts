/**
 * Build-vs-retag eligibility strategy.
 *
 * The CI pipeline tags a service's image by the base SHA and, when that image
 * already exists in GHCR, would rather retag it than rebuild. That reuse is only
 * safe when the service's OWN buildable source did not change. If a directly
 * changed service is retagged, CI ships a stale image missing the new/changed
 * source (this bit us when a new automations bot module referenced from the
 * mounted config was absent from the retagged image, crash-looping the container
 * with MODULE_NOT_FOUND).
 *
 * This module partitions the services considered for building into:
 *   - mustBuild: directly changed services whose changes are NOT test-only. These
 *     must ALWAYS build and must never be retag-eligible, regardless of whether a
 *     base-SHA image already exists.
 *   - retagEligible: everything else that was in scope, i.e. affected services
 *     (pulled in by a base-image change, own source unchanged) and changed
 *     services whose changes are test-only (preserving the test-only
 *     optimization). Only these are handed to the GHCR existence check.
 */

export interface BuildStrategyInput {
  /** Services whose own source changed (from detectChangedServices). */
  changedServices: string[];
  /** Services pulled in by a base-image change, own source unchanged. */
  affectedServices: string[];
  /** Returns true if the changed service's changes are test-only. */
  isTestOnly: (serviceName: string) => boolean;
}

export interface BuildStrategy {
  /** Services that must be rebuilt unconditionally (never retag-eligible). */
  mustBuild: string[];
  /** Services eligible for the GHCR existence check (retag if image exists). */
  retagEligible: string[];
}

/**
 * Partition in-scope services into unconditional builds vs retag-eligible.
 *
 * mustBuild = changed services that are not test-only.
 * retagEligible = (changed ∪ affected) minus mustBuild
 *               = affected services plus changed test-only services.
 *
 * Order within each list follows first-seen order of the inputs (changed before
 * affected) so downstream output is stable.
 */
export function partitionBuildStrategy(input: BuildStrategyInput): BuildStrategy {
  const { changedServices, affectedServices, isTestOnly } = input;

  const mustBuild = changedServices.filter((name) => !isTestOnly(name));
  const mustBuildSet = new Set(mustBuild);

  const retagEligible = Array.from(new Set([...changedServices, ...affectedServices])).filter(
    (name) => !mustBuildSet.has(name)
  );

  return { mustBuild, retagEligible };
}

export interface ShaTagInput {
  /**
   * Every compose service the detector discovered, i.e. the output of
   * `filterGhcrServices(discoverServicesFromCompose(...))`.
   *
   * That is NOT literally "every service in docker-compose.yml": discovery drops
   * any service without a `build:` directive, because `extractServiceMetadata`
   * returns null for one. All 38 compose services have a build directive today,
   * so the two sets coincide — but a service that reused an existing GHCR image
   * without building it would fall out of this list and therefore out of
   * `to_retag` as well, and would silently never be SHA-tagged. Stage 5C in
   * `ci-unified.yml` reads the compose file directly and fails the run if any
   * service is missing its SHA tag, so that gap is caught rather than assumed
   * away.
   */
  allServices: string[];
  /** Services this run rebuilds; they get their SHA tag from the build itself. */
  toBuild: string[];
}

/**
 * Services that need their existing image tagged at this commit's SHA.
 *
 * `deploy.sh` exports `IMAGE_TAG="$NEW_VERSION"` (the full commit SHA) and every
 * service in `docker-compose.yml` resolves `${IMAGE_TAG:-latest}`, so a default
 * deploy needs a SHA-tagged image for EVERY service — not only the ones this run
 * rebuilt. Services that were rebuilt get that tag from the build; every other
 * service must have its existing image retagged, or `docker compose pull` fails
 * with `manifest unknown` and the deploy aborts. See issue #1544.
 *
 * This is deliberately "all services minus the ones being built", not
 * "changed ∪ affected minus mustBuild" — the latter is the retag-*eligibility*
 * question that `partitionBuildStrategy` answers, and it excludes the untouched
 * services that make up most of the compose file.
 */
export function servicesNeedingShaTag(input: ShaTagInput): string[] {
  const building = new Set(input.toBuild);
  return Array.from(new Set(input.allServices))
    .filter((name) => !building.has(name))
    .sort();
}

export interface ShaTagImageInput {
  /** Compose service name -> GHCR image name, for every discovered service. */
  serviceImageNames: Record<string, string>;
  /** Services needing a SHA tag by retag (the `servicesNeedingShaTag` output). */
  toRetag: string[];
  /** Services this run rebuilds. Stage 5A tags their image at the SHA already. */
  toBuild: string[];
}

/**
 * The distinct GHCR image names stage 5B must retag at this commit's SHA.
 *
 * Every tag stage 5B writes addresses an *image name*, not a service name, and
 * several services share one image (the five `modbus-serial` instances, both
 * `mqtt-mongo` archivers). Driving the matrix by service name therefore spawns
 * up to 38 runners to perform at most ~20 distinct manifest copies, and — worse
 * — an image shared by a rebuilt service and an untouched one would be written
 * by stage 5A and stage 5B concurrently, both claiming `<image>:<sha>`.
 *
 * Collapsing to distinct image names and subtracting everything stage 5A owns
 * removes both problems: one runner per image, and no image written twice.
 */
export function imageNamesNeedingShaTag(input: ShaTagImageInput): string[] {
  const { serviceImageNames, toRetag, toBuild } = input;

  const imageOf = (service: string): string => serviceImageNames[service] ?? service;
  const builtImages = new Set(toBuild.map(imageOf));

  return Array.from(new Set(toRetag.map(imageOf)))
    .filter((image) => !builtImages.has(image))
    .sort();
}
