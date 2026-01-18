#!/bin/bash
#
# Production Deployment Script
#
# This script handles deployment of the homy home automation system
# with database-aware rollback capability.
#

set -euo pipefail

# Prevent concurrent deployments
LOCK_FILE="/var/lock/homy-deployment.lock"
exec 200>"$LOCK_FILE"
if ! flock -n 200; then
    echo "ERROR: Another deployment operation is in progress" >&2
    echo "If you're sure no other operation is running, remove: $LOCK_FILE" >&2
    exit 1
fi

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_LOG_DIR="$PROJECT_DIR/logs"
DEPLOY_LOG="$DEPLOY_LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
VERSION_FILE="$PROJECT_DIR/.deployed-version"
PREVIOUS_VERSION_FILE="$PROJECT_DIR/.previous-version"
BACKUP_REF_FILE="$PROJECT_DIR/.pre-upgrade-backup"

# Default values
FORCE_DEPLOY=false
IMAGE_TAG="${IMAGE_TAG:-}"
SKIP_CONFIRM=false
SKIP_BACKUP=false

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
            FORCE_DEPLOY=true
            shift
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        --skip-backup)
            SKIP_BACKUP=true
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

# Track if services were stopped
SERVICES_STOPPED=false

# Cleanup handler for interruption
cleanup() {
    local exit_code=$?
    if [ "$SERVICES_STOPPED" = true ]; then
        log "Script interrupted! Attempting to restart services..."
        docker compose up -d || true
        log "Emergency restart attempted. Check service status!"
    fi
    exit $exit_code
}

trap cleanup EXIT INT TERM

# Load secrets for notifications (optional)
TELEGRAM_TOKEN=""
TELEGRAM_CHAT_ID=""
[ -f "$PROJECT_DIR/secrets/telegram_bot_token" ] && TELEGRAM_TOKEN=$(cat "$PROJECT_DIR/secrets/telegram_bot_token")
[ -f "$PROJECT_DIR/secrets/telegram_chat_id" ] && TELEGRAM_CHAT_ID=$(cat "$PROJECT_DIR/secrets/telegram_chat_id")

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$DEPLOY_LOG"
}

notify() {
    local message="$1"
    if [ -n "$TELEGRAM_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        curl -s -X POST \
            "https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage" \
            -d chat_id="${TELEGRAM_CHAT_ID}" \
            -d text="$message" \
            -d parse_mode="HTML" > /dev/null 2>&1 || true
    fi
}

cleanup_old_logs() {
    # Keep only the last 30 deployment logs
    local log_count
    log_count=$(ls -1 "$DEPLOY_LOG_DIR"/deploy-*.log 2>/dev/null | wc -l || echo "0")
    if [ "$log_count" -gt 30 ]; then
        log "Cleaning up old deployment logs..."
        ls -1t "$DEPLOY_LOG_DIR"/deploy-*.log | tail -n +31 | xargs rm -f
    fi
}

confirm() {
    if [ "$SKIP_CONFIRM" = true ]; then
        return 0
    fi

    local prompt="$1"
    echo ""
    read -r -p "$prompt [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Change to project directory
cd "$PROJECT_DIR"

# Pre-flight checks
log "Starting deployment..."
log "Project directory: $PROJECT_DIR"
log "Deployment log: $DEPLOY_LOG"

if [ ! -f docker-compose.yml ]; then
    log "ERROR: docker-compose.yml not found. Not in project root?"
    exit 1
fi

# Record current state
CURRENT_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "unknown")
log "Current version: $CURRENT_VERSION"

# Validate IMAGE_TAG if provided (prevent injection)
if [ -n "$IMAGE_TAG" ]; then
    # Allow: git SHA (7-40 hex), semver, 'latest', or branch names (alphanumeric with .-_)
    if ! echo "$IMAGE_TAG" | grep -qE '^[a-fA-F0-9]{7,40}$|^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.]+)?$|^latest$|^[a-zA-Z0-9._-]+$'; then
        log "ERROR: Invalid IMAGE_TAG format: $IMAGE_TAG"
        log "IMAGE_TAG must be a git SHA, semantic version (v1.2.3), branch name, or 'latest'"
        exit 1
    fi
fi

# Fetch latest and determine new version
log "Fetching latest changes from origin..."
git fetch origin master

NEW_VERSION="${IMAGE_TAG:-$(git rev-parse origin/master)}"
log "Target version: $NEW_VERSION"

if [ "$CURRENT_VERSION" = "$NEW_VERSION" ] && [ "$FORCE_DEPLOY" = false ]; then
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
if [ "$SKIP_BACKUP" = true ]; then
    log ""
    log "⚠️  WARNING: You are deploying WITHOUT a backup!"
    log "⚠️  If deployment fails, rollback will NOT be possible!"
    log "⚠️  You may lose data if something goes wrong!"
    log ""

    # Only require manual confirmation if --yes flag was not provided
    if [ "$SKIP_CONFIRM" = false ]; then
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
if ! docker compose pull 2>&1 | tee -a "$DEPLOY_LOG"; then
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
if [ "$SKIP_BACKUP" = false ]; then
    # Create backup (stops services, creates backup, but doesn't restart)
    log "Creating backup before upgrade..."
    BACKUP_NAME=$("$SCRIPT_DIR/backup.sh" --stop --yes --quiet --no-lock) || {
        log "ERROR: Backup failed"
        notify "Deployment failed: Backup error"
        # Try to restart services
        docker compose up -d
        exit 1
    }
    log "Backup created: $BACKUP_NAME"
    SERVICES_STOPPED=true
else
    # Skip backup but still stop services for clean deployment
    log "Skipping backup (as requested)..."
    log "Stopping services..."
    docker compose down
    SERVICES_STOPPED=true
fi

# Start services with new images
log "Starting services..."
docker compose up -d
SERVICES_STOPPED=false

# Health check loop
log "Waiting for services to be healthy..."
HEALTHY=false
MAX_WAIT=300  # 5 minutes
WAIT_INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))

    # docker compose ps --format json outputs NDJSON (one JSON object per line)
    # Use jq -s to slurp lines into an array, then filter
    # Also check State for containers without health checks

    # Check for unhealthy or exited containers
    UNHEALTHY=$(docker compose ps --format json 2>/dev/null | jq -rs '[.[] | select(.Health == "unhealthy" or .State == "exited")] | .[].Name' 2>/dev/null | head -5 || echo "")

    if [ -z "$UNHEALTHY" ]; then
        # No unhealthy containers - check if any are still starting
        STARTING=$(docker compose ps --format json 2>/dev/null | jq -rs '[.[] | select(.Health == "starting")] | .[].Name' 2>/dev/null | head -5 || echo "")
        if [ -z "$STARTING" ]; then
            HEALTHY=true
            break
        fi
        log "Waiting... still starting: $STARTING (${ELAPSED}s)"
    else
        log "Waiting... unhealthy: $UNHEALTHY (${ELAPSED}s)"
    fi
done

if [ "$HEALTHY" = true ]; then
    log "Deployment successful!"

    # Save previous version before updating
    if [ "$CURRENT_VERSION" != "unknown" ]; then
        echo "$CURRENT_VERSION" > "${PREVIOUS_VERSION_FILE}.tmp"
        mv "${PREVIOUS_VERSION_FILE}.tmp" "$PREVIOUS_VERSION_FILE"
        log "Previous version saved: $CURRENT_VERSION"
    fi

    echo "$NEW_VERSION" > "${VERSION_FILE}.tmp"
    mv "${VERSION_FILE}.tmp" "$VERSION_FILE"
    notify "Deployment successful: ${NEW_VERSION:0:8}"
    cleanup_old_logs
else
    log "ERROR: Services unhealthy after ${MAX_WAIT}s"
    log "Unhealthy services:"
    docker compose ps | tee -a "$DEPLOY_LOG"

    notify "Deployment failed: Services unhealthy. Initiating rollback..."

    log "Initiating automatic rollback..."
    if "$SCRIPT_DIR/rollback.sh" --yes; then
        notify "Rollback completed successfully"
    else
        notify "CRITICAL: Rollback also failed! Manual intervention required."
    fi
    exit 1
fi

log "Deployment complete."
