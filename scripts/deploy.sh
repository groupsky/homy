#!/bin/bash
#
# Production Deployment Script
#
# This script handles deployment of the homy home automation system
# with database-aware rollback capability.
#

set -euo pipefail

# Load common helper functions
source "$(dirname "$0")/docker-helper.sh"

# Configuration
DEPLOY_LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$DEPLOY_LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"

# Default values
FORCE_DEPLOY=0
IMAGE_TAG="${IMAGE_TAG:-}"
YES_FLAG=0
SKIP_BACKUP=0

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS]

Deploy the homy home automation system with prebuilt images from GHCR.

Options:
  -h, --help          Show this help message and exit
  -t, --tag TAG       Deploy specific image tag (git SHA, branch name, or 'latest')
                      Examples: -t abc1234, -t feature-branch, -t latest
  -f, --force         Force redeploy even if already at target version
  -y, --yes           Skip confirmation prompt
  --skip-backup       Skip database backup (DANGEROUS - use only in emergencies)

Examples:
  $(basename "$0")                    # Deploy latest from master
  $(basename "$0") --tag abc1234      # Deploy specific git SHA
  $(basename "$0") --tag latest -f    # Force redeploy latest
  $(basename "$0") -t feature-x -y    # Deploy branch without confirmation
  $(basename "$0") --skip-backup      # Deploy without backup (requires confirmation)

Environment Variables:
  IMAGE_TAG           Alternative way to specify image tag (--tag takes precedence)

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
        --skip-backup)
            SKIP_BACKUP=1
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

# Setup emergency restart handler
setup_emergency_restart

# Acquire deployment lock
acquire_lock

# Load notification secrets
load_notification_secrets

# Change to project directory
cd "$PROJECT_DIR"

# Pre-flight checks
log "Starting deployment..."
log "Project directory: $PROJECT_DIR"
log "Deployment log: $LOG_FILE"

validate_compose_file

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
git fetch origin master

NEW_VERSION="${IMAGE_TAG:-$(git rev-parse origin/master)}"
log "Target version: $NEW_VERSION"

if [ "$CURRENT_VERSION" = "$NEW_VERSION" ] && [ "$FORCE_DEPLOY" -eq 0 ]; then
    log "Already at target version. Use --force to redeploy."
    exit 0
fi

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
echo "    1. Pull new images from GHCR"
echo "    2. Stop all services"
echo "    3. Create a backup of databases"
echo "    4. Start services with new version"
echo "    5. Verify health (auto-rollback on failure)"
echo ""
echo "═══════════════════════════════════════════════════════════════"

if ! confirm "Proceed with deployment?"; then
    log "Deployment cancelled by user"
    exit 0
fi

# Extra confirmation for --skip-backup
if [ "$SKIP_BACKUP" -eq 1 ]; then
    log ""
    log "⚠️  WARNING: You are deploying WITHOUT a backup!"
    log "⚠️  If deployment fails, rollback will NOT be possible!"
    log "⚠️  You may lose data if something goes wrong!"
    log ""

    # Only require manual confirmation if --yes flag was not provided
    if [ "$YES_FLAG" -eq 0 ]; then
        read -r -p "Type 'yes-skip-backup' to confirm: " confirmation
        if [ "$confirmation" != "yes-skip-backup" ]; then
            log "Deployment cancelled. Use without --skip-backup for safe deployment."
            exit 1
        fi
    fi
    log "Proceeding without backup as confirmed..."
fi

# Update code (only if not using IMAGE_TAG override)
if [ -z "$IMAGE_TAG" ]; then
    log "Pulling latest code..."
    git checkout master
    git pull origin master
    NEW_VERSION=$(git rev-parse HEAD)
fi

# Set image tag for prebuilt images
export IMAGE_TAG="$NEW_VERSION"
log "Using IMAGE_TAG: $IMAGE_TAG"

# Pull prebuilt images from GHCR (while services are still running)
log "Pulling prebuilt images from GHCR..."
if ! dc_run pull 2>&1 | tee -a "$LOG_FILE"; then
    log "ERROR: Failed to pull images from GHCR"
    log "This usually means:"
    log "  - Images for tag '$IMAGE_TAG' don't exist in GHCR"
    log "  - Network connectivity issues"
    log "  - Authentication problems"
    log ""
    log "Please check:"
    log "  1. CI workflow completed successfully for this version"
    log "  2. Images exist: docker manifest inspect ghcr.io/groupsky/homy/automations:$IMAGE_TAG"
    log "  3. GHCR authentication: docker login ghcr.io"
    notify "Deployment failed: Could not pull images for tag $IMAGE_TAG"
    exit 1
fi

# Create pre-upgrade backup or just stop services
if [ "$SKIP_BACKUP" -eq 0 ]; then
    # Create backup (stops services, creates backup, but doesn't restart)
    log "Creating backup before upgrade..."
    BACKUP_NAME=$("$SCRIPT_DIR/backup.sh" --stop --yes --quiet --no-lock) || {
        log "ERROR: Backup failed"
        notify "Deployment failed: Backup error"
        # Try to restart services
        dc_run up -d
        exit 1
    }
    log "Backup created: $BACKUP_NAME"
    mark_services_stopped
else
    # Skip backup but still stop services for clean deployment
    log "Skipping backup (as requested)..."
    log "Stopping services..."
    dc_run down
    mark_services_stopped
fi

# Start services with new images
log "Starting services..."
dc_run up -d
mark_services_running

# Health check
log "Waiting for services to be healthy..."
if wait_for_health "$HEALTH_CHECK_TIMEOUT_DEPLOY"; then
    log "Deployment successful!"

    # Save previous version before updating
    if [ "$CURRENT_VERSION" != "unknown" ]; then
        save_previous_version "$CURRENT_VERSION"
        log "Previous version saved: $CURRENT_VERSION"
    fi

    save_deployed_version "$NEW_VERSION"
    notify "Deployment successful: $(format_version_short "$NEW_VERSION")"
    cleanup_old_logs "$DEPLOY_LOG_DIR" "deploy-*.log" 30
else
    log "ERROR: Services unhealthy after timeout"
    log "Unhealthy services:"
    dc_run ps | tee -a "$LOG_FILE"

    notify "Deployment failed: Services unhealthy. Initiating rollback..."

    log "Initiating automatic rollback..."
    if "$SCRIPT_DIR/rollback.sh" --yes --no-lock; then
        notify "Rollback completed successfully"
    else
        notify "CRITICAL: Rollback also failed! Manual intervention required."
    fi
    exit 1
fi

log "Deployment complete."
