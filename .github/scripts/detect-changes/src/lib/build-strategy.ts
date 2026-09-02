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
  /** Every service in docker-compose.yml that has a GHCR image. */
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
