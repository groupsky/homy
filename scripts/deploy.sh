#!/bin/bash
#
# Production Deployment Script
#
# Deploys the homy stack from prebuilt GHCR images while it keeps running:
#   1. one ZFS snapshot of all the stack's data (about a second, nothing stops)
#   2. update the code and pull the images
#   3. pin every service to its image digest and a hash of the config files it
#      mounts, so compose recreates only the services that really changed
#   4. health-gate the recreated services
#   5. on failure, roll code, config and images back together - never data.
#      A stateful service whose image changed is left for a manual restore
#      from the snapshot (restore-snapshot.sh).
#

set -euo pipefail

# Load common helper functions
HELPER_SCRIPT="$(dirname "$0")/docker-helper.sh"
if [ ! -f "$HELPER_SCRIPT" ]; then
    echo "FATAL: Required helper library not found: $HELPER_SCRIPT" >&2
    exit 1
fi
# shellcheck source=scripts/docker-helper.sh
source "$HELPER_SCRIPT" || {
    echo "FATAL: Failed to load helper library: $HELPER_SCRIPT" >&2
    exit 1
}

# Configuration
DEPLOY_LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$DEPLOY_LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
# snapshot.sh logs into the same file
export LOG_FILE

# Default values
FORCE_DEPLOY=0
IMAGE_TAG="${IMAGE_TAG:-}"
YES_FLAG=0
SKIP_SNAPSHOT=0

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Deploy the homy home automation system with prebuilt images from GHCR.
The stack keeps running; only services whose image or configuration changed
are recreated.

Options:
  -h, --help          Show this help message and exit
  -t, --tag TAG       Deploy specific image tag (git SHA, branch name, or 'latest')
                      Examples: -t abc1234, -t feature-branch, -t latest
  -f, --force         Force redeploy even if already at target version
  -y, --yes           Skip confirmation prompt
  --skip-snapshot     Deploy without the pre-deploy ZFS snapshot (DANGEROUS:
                      a stateful service that breaks cannot be restored)
  --skip-backup       Old name of --skip-snapshot

Examples:
  $(basename "$0")                    # Deploy latest from master
  $(basename "$0") --tag abc1234      # Deploy specific git SHA
  $(basename "$0") --tag latest -f    # Force redeploy latest
  $(basename "$0") -t feature-x -y    # Deploy branch without confirmation
  $(basename "$0") --skip-snapshot    # Deploy on a host without ZFS (requires confirmation)

Environment Variables:
  IMAGE_TAG             Alternative way to specify image tag (--tag takes precedence)
  SNAPSHOT_MIN_FREE_GB  Refuse the snapshot below this much free pool space (default 20)
  HEALTH_STABLE_SECONDS A service without a healthcheck passes after running
                        this long without a restart (default 30)

EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -t|--tag)
            IMAGE_TAG="$2"
            shift 2
            ;;
        -f|--force)
            FORCE_DEPLOY=1
            shift
            ;;
        -y|--yes)
            YES_FLAG=1
            shift
            ;;
        --skip-snapshot|--skip-backup)
            SKIP_SNAPSHOT=1
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
    esac
done

# Ensure log directory exists
mkdir -p "$DEPLOY_LOG_DIR"

# Acquire deployment lock
acquire_lock

# Load notification secrets
load_notification_secrets

# A deploy that failed and could not be rolled back automatically leaves the
# stack between versions. Running another deploy on top would compare against
# the wrong "before" (and could roll a stateful image back onto migrated
# data), so it waits until someone has looked.
DEPLOY_BLOCK_FILE="${DEPLOY_BLOCK_FILE:-$PROJECT_DIR/.deploy-blocked}"
if [ -f "$DEPLOY_BLOCK_FILE" ]; then
    error "A previous deploy failed and was not rolled back. Deploying is blocked until it is resolved:"
    cat "$DEPLOY_BLOCK_FILE" >&2
    echo "" >&2
    echo "When the stack is sorted out, remove $DEPLOY_BLOCK_FILE and deploy again." >&2
    notify "Deployment refused: a previous failed deploy is not resolved ($(basename "$DEPLOY_BLOCK_FILE") is present)"
    exit 1
fi

# Change to project directory
cd "$PROJECT_DIR"

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

# Pre-flight checks
log "Starting deployment..."
log "Project directory: $PROJECT_DIR"
log "Deployment log: $LOG_FILE"

validate_compose_file
require_jq

if ! require_compose_v2; then
    notify "Deployment failed: docker compose v2 is required on this host"
    exit 1
fi

# Record current state
CURRENT_VERSION=$(get_deployed_version)
log "Current version: $CURRENT_VERSION"

# Validate IMAGE_TAG if provided
if [ -n "$IMAGE_TAG" ]; then
    if ! validate_image_tag "$IMAGE_TAG"; then
        exit 1
    fi
fi

# Fetch latest and determine new version
log "Fetching latest changes from origin..."
# Non-recursive for the same reason as the pull below - `git fetch` is one of
# the commands submodule.recurse applies to. See git_no_submodules(), #1406.
git_no_submodules fetch origin master

NEW_VERSION="${IMAGE_TAG:-$(git rev-parse origin/master)}"
log "Target version: $NEW_VERSION"

if [ "$CURRENT_VERSION" = "$NEW_VERSION" ] && [ "$FORCE_DEPLOY" -eq 0 ]; then
    log "Already at target version. Use --force to redeploy."
    exit 0
fi

# Short SHA for the snapshot name: a full or short SHA as given, else what git
# resolves the tag or branch to, else the tag itself made safe for ZFS
deploy_short_sha() {
    local version="$1" sha
    if [[ "$version" =~ ^[0-9a-f]{7,40}$ ]]; then
        echo "${version:0:7}"
        return
    fi
    for ref in "$version" "origin/$version"; do
        if sha=$(git rev-parse --verify -q --short=7 "${ref}^{commit}" 2>/dev/null) && [ -n "$sha" ]; then
            echo "$sha"
            return
        fi
    done
    echo "$version" | tr -c 'A-Za-z0-9._\n-' '-'
}

# Show deployment plan and ask for confirmation
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                     DEPLOYMENT PLAN"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Current version:  $CURRENT_VERSION"
echo "  Target version:   $NEW_VERSION"
echo "  Force deploy:     $FORCE_DEPLOY"
echo ""
echo "  This will:"
if [ "$SKIP_SNAPSHOT" -eq 0 ]; then
    echo "    1. Snapshot the stack's data (ZFS; nothing is stopped)"
else
    echo "    1. NOT snapshot the data (--skip-snapshot)"
fi
echo "    2. Update the code and pull the new images from GHCR"
echo "    3. Recreate only the services whose image or configuration changed"
echo "    4. Health-check the recreated services; on failure roll code and"
echo "       images back (data is never rolled back automatically)"
echo ""
echo "═══════════════════════════════════════════════════════════════"

if ! confirm "Proceed with deployment?"; then
    log "Deployment cancelled by user"
    exit 0
fi

# Extra confirmation for --skip-snapshot
if [ "$SKIP_SNAPSHOT" -eq 1 ]; then
    log ""
    log "⚠️  WARNING: You are deploying WITHOUT a snapshot of the data!"
    log "⚠️  If a stateful service breaks, its data cannot be restored from this deploy."
    log ""

    # Only require manual confirmation if --yes flag was not provided
    if [ "$YES_FLAG" -eq 0 ]; then
        read -r -p "Type 'yes-skip-snapshot' to confirm: " confirmation
        if [ "$confirmation" != "yes-skip-snapshot" ]; then
            log "Deployment cancelled. Use without --skip-snapshot for safe deployment."
            exit 1
        fi
    fi
    log "Proceeding without a snapshot as confirmed..."
fi

# 1. Snapshot, before anything is touched
SNAPSHOT_NAME=""
if [ "$SKIP_SNAPSHOT" -eq 0 ]; then
    log "Taking the pre-deploy snapshot..."
    if ! SNAPSHOT_NAME=$("$SCRIPT_DIR/snapshot.sh" --sha "$(deploy_short_sha "$NEW_VERSION")"); then
        error "Snapshot failed; nothing was changed. Fix it, or deploy with --skip-snapshot."
        notify "Deployment of $(format_version_short "$NEW_VERSION") stopped: the pre-deploy snapshot failed. Nothing was changed."
        exit 1
    fi
    log "Snapshot: $SNAPSHOT_NAME"
else
    log "Skipping the snapshot (as requested)..."
fi

# 2. Code and images
PREV_HEAD=$(git rev-parse HEAD 2>/dev/null || echo "")
CODE_UPDATED=0

# Put the working tree back where it was: the running containers mount their
# config from it
restore_previous_code() {
    if [ "$CODE_UPDATED" -eq 1 ] && [ -n "$PREV_HEAD" ]; then
        log "Putting the code back to $PREV_HEAD..."
        if checkout_git_version "$PREV_HEAD" "$LOG_FILE"; then
            update_submodules
        else
            return 1
        fi
    fi
}

if [ -z "$IMAGE_TAG" ]; then
    if ! update_code; then
        error "Failed to update code to origin/master"
        notify "Deployment failed: could not update code"
        exit 1
    fi
    CODE_UPDATED=1
    NEW_VERSION=$(git rev-parse HEAD)
fi

# Set image tag for prebuilt images
export IMAGE_TAG="$NEW_VERSION"
log "Using IMAGE_TAG: $IMAGE_TAG"

# Pull prebuilt images from GHCR (while services are still running)
log "Pulling prebuilt images from GHCR..."
if ! dc_base pull 2>&1 | tee -a "$LOG_FILE"; then
    error "Failed to pull images from GHCR"
    log "This usually means:"
    log "  - Images for tag '$IMAGE_TAG' don't exist in GHCR"
    log "  - Network connectivity issues"
    log "  - Authentication problems"
    log ""
    log "Please check:"
    log "  1. CI workflow completed successfully for this version"
    log "  2. Images exist: docker manifest inspect ghcr.io/groupsky/homy/automations:$IMAGE_TAG"
    log "  3. GHCR authentication: docker login ghcr.io"
    restore_previous_code || true
    notify "Deployment failed: Could not pull images for tag $IMAGE_TAG. Nothing was restarted."
    exit 1
fi

# 3. Pin images by digest and label config hashes; compose then recreates
#    only what differs from the running containers
CONFIG_JSON="$WORK_DIR/config.json"
if ! dc_base config --format json > "$CONFIG_JSON" || \
   ! generate_deploy_override "$CONFIG_JSON" "$WORK_DIR/override.json"; then
    error "Could not prepare the deploy override"
    restore_previous_code || true
    notify "Deployment of $(format_version_short "$NEW_VERSION") failed before restarting anything: could not prepare the deploy override"
    exit 1
fi
mapfile -t SERVICES < <(long_running_services "$CONFIG_JSON")

# 4. Recreate what changed, then gate it
BEFORE_OK=1
if ! container_states > "$WORK_DIR/before"; then
    warn "Could not read the containers before up; the gate will check every service"
    BEFORE_OK=0
fi

# Two containers for one service (a leftover from an interrupted recreate):
# neither the change detection nor the gate could tell which one counts.
# Checked before the new override replaces the old one, so a refusal leaves
# the pins of the running version in place.
mapfile -t DUPLICATES < <(duplicate_services "$WORK_DIR/before")
if [ "${#DUPLICATES[@]}" -gt 0 ]; then
    error "These services have more than one container: ${DUPLICATES[*]}. Remove the leftover ones (docker ps -a) and deploy again."
    restore_previous_code || true
    notify "Deployment of $(format_version_short "$NEW_VERSION") refused before restarting anything: more than one container for ${DUPLICATES[*]}"
    exit 1
fi

mv "$WORK_DIR/override.json" "$DEPLOY_OVERRIDE_FILE"

UP_OK=1
log "Starting services (only changed ones are recreated)..."
if ! deploy_up "${SERVICES[@]}"; then
    error "docker compose up failed"
    UP_OK=0
fi

AFTER_OK=1
if ! container_states > "$WORK_DIR/after"; then
    error "Could not read the containers after up"
    AFTER_OK=0
fi
if [ "$BEFORE_OK" -eq 1 ] && [ "$AFTER_OK" -eq 1 ]; then
    mapfile -t CHANGED < <(changed_services "$WORK_DIR/before" "$WORK_DIR/after")
    mapfile -t IMAGE_CHANGED < <(image_changed_services "$WORK_DIR/before" "$WORK_DIR/after")
else
    # Unknown: assume everything changed (gate all; roll no stateful image back)
    [ "$AFTER_OK" -eq 1 ] || : > "$WORK_DIR/after"
    CHANGED=("${SERVICES[@]}")
    IMAGE_CHANGED=("${SERVICES[@]}")
fi
log "Recreated or started: ${CHANGED[*]:-none}"

GATE_RC=1
FAILURE="docker compose up failed"
# What failed: the unhealthy services, or after a failed up what it did change
# (not every service passed to it: compose may have stopped before reaching some)
FAILED_SERVICES=("${CHANGED[@]}")
if [ "$UP_OK" -eq 1 ] && [ "$AFTER_OK" -eq 0 ]; then
    GATE_RC=2
elif [ "$UP_OK" -eq 1 ]; then
    GATE_RC=0
    health_gate "${CHANGED[@]}" || GATE_RC=$?
    FAILURE="unhealthy: ${HEALTH_GATE_FAILURES:-}"
    read -r -a FAILED_SERVICES <<<"${HEALTH_GATE_FAILED_SERVICES:-}"
fi

SHORT_NEW=$(format_version_short "$NEW_VERSION")
SNAPSHOT_NOTE="${SNAPSHOT_NAME:-none (--skip-snapshot)}"

# Stop further deploys until a human has looked (see the check at the top)
# Usage: block_deploys "reason" [recovery text]
block_deploys() {
    {
        echo "time: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        echo "failed deploy: $NEW_VERSION (from $CURRENT_VERSION)"
        echo "reason: $1"
        echo "snapshot: $SNAPSHOT_NOTE"
        if [ -n "${2:-}" ]; then
            echo ""
            echo "$2"
        fi
    } > "$DEPLOY_BLOCK_FILE"
    log "Further deploys are blocked until $DEPLOY_BLOCK_FILE is removed"
}

if [ "$GATE_RC" -eq 0 ]; then
    log "Deployment successful!"

    # Save previous version before updating
    if [ "$CURRENT_VERSION" != "unknown" ]; then
        save_previous_version "$CURRENT_VERSION"
        log "Previous version saved: $CURRENT_VERSION"
    fi

    save_deployed_version "$NEW_VERSION"
    notify "Deployment successful: $SHORT_NEW (recreated: ${CHANGED[*]:-none}; snapshot: $SNAPSHOT_NOTE)"
    cleanup_old_logs "$DEPLOY_LOG_DIR" "deploy-*.log" 30
    log "Deployment complete."
    exit 0
fi

if [ "$GATE_RC" -eq 2 ]; then
    error "The health gate could not check the services; not reporting success and not rolling back"
    dc_run ps 2>&1 | tee -a "$LOG_FILE" || true
    block_deploys "the health gate could not check the services" \
        "Check the services by hand. If they are fine, record the version: echo $NEW_VERSION > $VERSION_FILE"
    notify "Deployment of $SHORT_NEW: the health gate could NOT check the services. Not rolled back - check them by hand. Snapshot: $SNAPSHOT_NOTE"
    exit 1
fi

# 5. Rollback
error "Deployment failed: $FAILURE"
dc_run ps 2>&1 | tee -a "$LOG_FILE" || true

# A stateful service that got a new image may already have migrated its data
# (HA recorder schema, zigbee2mqtt database, Mongo, Grafana); the old image
# cannot read it. Leave it for the manual restore from the snapshot.
mapfile -t STATEFUL < <(stateful_services "$CONFIG_JSON")
mapfile -t BLOCKERS < <(comm -12 <(printf '%s\n' "${STATEFUL[@]}" | LC_ALL=C sort -u) \
                                 <(printf '%s\n' "${IMAGE_CHANGED[@]}" | LC_ALL=C sort -u) | sed '/^$/d')

if [ "${#BLOCKERS[@]}" -gt 0 ]; then
    error "Not rolling back: the image of stateful service(s) ${BLOCKERS[*]} changed"
    if [ -n "$SNAPSHOT_NAME" ]; then
        RECOVERY="Either fix forward, or go back to $CURRENT_VERSION with its data from before this deploy:
  1. sudo scripts/restore-snapshot.sh --no-start --snapshot $SNAPSHOT_NAME ${BLOCKERS[*]}
     (restores their data and leaves them stopped, so the new image does not migrate it again)
  2. git -c submodule.recurse=false checkout $CURRENT_VERSION && git submodule update --init --recursive
  3. rm $DEPLOY_BLOCK_FILE
  4. scripts/deploy.sh --tag $CURRENT_VERSION --force
     (recreates every service the failed deploy changed on the old images)"
    else
        RECOVERY="No snapshot was taken (--skip-snapshot): their data cannot be restored from this deploy. Fix forward."
    fi
    log "$RECOVERY"
    block_deploys "stateful service(s) ${BLOCKERS[*]} got a new image and the deploy failed ($FAILURE)" "$RECOVERY"
    notify "CRITICAL: Deployment of $SHORT_NEW failed ($FAILURE) and changed the image of stateful service(s) ${BLOCKERS[*]}. NOT rolled back: their data may already be migrated. Snapshot: $SNAPSHOT_NOTE. Restore by hand with scripts/restore-snapshot.sh."
    exit 1
fi

rollback_failed() {
    error "Rollback failed: $1"
    block_deploys "the deploy failed ($FAILURE) and so did the rollback: $1"
    notify "CRITICAL: Rollback of $SHORT_NEW to $(format_version_short "$CURRENT_VERSION") failed: $1. Manual intervention required. Snapshot: $SNAPSHOT_NOTE"
    exit 1
}

# A forced redeploy of the running version that fails: the cause is on the
# host (.env, a secret, config outside git), and the same commit cannot fix it
if [ "$CURRENT_VERSION" = "$NEW_VERSION" ]; then
    rollback_failed "the failed deploy was of the version already running ($SHORT_NEW), so there is nothing to roll back to; the cause is on the host (.env, secrets or config outside git)"
fi

# The rollback goes to the commit (code, config) and the images of the last
# successful deploy. Only a commit SHA names both; a tag such as "latest" may
# point at the failed images by now.
if ! [[ "$CURRENT_VERSION" =~ ^[0-9a-f]{40}$ ]] || \
   ! git rev-parse --verify -q "${CURRENT_VERSION}^{commit}" > /dev/null 2>&1; then
    error "The previous version ($CURRENT_VERSION in $VERSION_FILE) is not a known commit SHA; roll back by hand"
    block_deploys "the deploy failed ($FAILURE) and the previous version '$CURRENT_VERSION' is not a commit SHA, so nothing was rolled back"
    notify "CRITICAL: Deployment of $SHORT_NEW failed ($FAILURE). The previous version is not a known commit, so nothing was rolled back."
    exit 1
fi

notify "Deployment of $SHORT_NEW failed ($FAILURE). Rolling code and images back to $(format_version_short "$CURRENT_VERSION"); no data is restored..."
log "Rolling back code, config and images to $CURRENT_VERSION (no data is restored)..."

log "Checking out $CURRENT_VERSION..."
if checkout_git_version "$CURRENT_VERSION" "$LOG_FILE"; then
    update_submodules
else
    rollback_failed "could not check out $CURRENT_VERSION"
fi

export IMAGE_TAG="$CURRENT_VERSION"
log "Using IMAGE_TAG: $IMAGE_TAG"
if ! dc_base pull 2>&1 | tee -a "$LOG_FILE"; then
    warn "Pulling the previous images failed; using the images already on this host"
fi

ROLLBACK_CONFIG="$WORK_DIR/rollback-config.json"
if ! dc_base config --format json > "$ROLLBACK_CONFIG" || \
   ! generate_deploy_override "$ROLLBACK_CONFIG" "$WORK_DIR/rollback-override.json"; then
    rollback_failed "could not prepare the override for $CURRENT_VERSION"
fi
mv "$WORK_DIR/rollback-override.json" "$DEPLOY_OVERRIDE_FILE"
mapfile -t SERVICES < <(long_running_services "$ROLLBACK_CONFIG")

container_states > "$WORK_DIR/rollback-before" || : > "$WORK_DIR/rollback-before"
if ! deploy_up "${SERVICES[@]}"; then
    rollback_failed "docker compose up failed"
fi
if ! container_states > "$WORK_DIR/rollback-after"; then
    rollback_failed "could not read the containers after up"
fi
# An empty "before" makes every service count as changed, so all are gated
mapfile -t ROLLBACK_CHANGED < <(changed_services "$WORK_DIR/rollback-before" "$WORK_DIR/rollback-after")
log "Rollback recreated: ${ROLLBACK_CHANGED[*]:-none}"

# A failed service the rollback did not recreate is still the broken
# container: its cause is not in the code (.env, a secret, config outside git)
NOT_RECREATED=()
for svc in "${FAILED_SERVICES[@]}"; do
    if ! printf '%s\n' "${ROLLBACK_CHANGED[@]}" | grep -qxF -- "$svc"; then
        NOT_RECREATED+=("$svc")
    fi
done
if [ "${#NOT_RECREATED[@]}" -gt 0 ]; then
    if [ "$AFTER_OK" -eq 0 ]; then
        rollback_failed "the containers could not be read after the failed up, and the rollback did not recreate ${NOT_RECREATED[*]}; check them by hand"
    fi
    rollback_failed "the rollback did not recreate ${NOT_RECREATED[*]}, so they are still the failed containers; the cause is likely on the host (.env, secrets or config outside git)"
fi

# Gate what either the deploy or the rollback touched
mapfile -t GATE_SERVICES < <(printf '%s\n' "${CHANGED[@]}" "${ROLLBACK_CHANGED[@]}" | sed '/^$/d' | LC_ALL=C sort -u)
if health_gate "${GATE_SERVICES[@]}"; then
    log "Rollback to $CURRENT_VERSION complete; the deploy of $NEW_VERSION failed"
    notify "Rolled back to $(format_version_short "$CURRENT_VERSION") after the failed deployment of $SHORT_NEW. No data was restored."
    exit 1
fi
rollback_failed "the rolled-back services are not healthy (${HEALTH_GATE_FAILURES:-could not check})"
