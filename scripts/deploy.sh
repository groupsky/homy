#!/bin/bash
#
# Production Deployment Script
#
# This script handles deployment of the homy home automation system
# with database-aware rollback capability.
#
# Usage:
#   ./scripts/deploy.sh           # Deploy latest version from master
#   ./scripts/deploy.sh --force   # Redeploy current version
#   IMAGE_TAG=abc1234 ./scripts/deploy.sh --force  # Deploy specific version
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DEPLOY_LOG_DIR="$PROJECT_DIR/logs"
DEPLOY_LOG="$DEPLOY_LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"
VERSION_FILE="$PROJECT_DIR/.deployed-version"
BACKUP_REF_FILE="$PROJECT_DIR/.pre-upgrade-backup"

# Ensure log directory exists
mkdir -p "$DEPLOY_LOG_DIR"

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

# Check for --force flag
FORCE_DEPLOY=false
for arg in "$@"; do
    if [ "$arg" = "--force" ]; then
        FORCE_DEPLOY=true
    fi
done

# Fetch latest and determine new version
log "Fetching latest changes from origin..."
git fetch origin master

NEW_VERSION="${IMAGE_TAG:-$(git rev-parse origin/master)}"
log "Target version: $NEW_VERSION"

if [ "$CURRENT_VERSION" = "$NEW_VERSION" ] && [ "$FORCE_DEPLOY" = false ]; then
    log "Already at target version. Use --force to redeploy."
    exit 0
fi

# Create pre-upgrade backup
log "Creating backup before upgrade..."
BACKUP_NAME=$(date +%Y_%m_%d_%H_%M_%S)

# Stop services first for clean backup
log "Stopping services for backup..."
docker compose down

# Run backup
if ! docker compose run --rm volman backup; then
    log "ERROR: Backup failed"
    notify "Deployment failed: Backup error"
    # Try to restart services
    docker compose up -d
    exit 1
fi

echo "$BACKUP_NAME" > "$BACKUP_REF_FILE"
log "Backup created: $BACKUP_NAME"

# Update code (only if not using IMAGE_TAG override)
if [ -z "${IMAGE_TAG:-}" ]; then
    log "Pulling latest code..."
    git checkout master
    git pull origin master
    NEW_VERSION=$(git rev-parse HEAD)
fi

# Set image tag for prebuilt images
export IMAGE_TAG="$NEW_VERSION"
log "Using IMAGE_TAG: $IMAGE_TAG"

# Pull prebuilt images from GHCR
log "Pulling prebuilt images from GHCR..."
if ! docker compose pull 2>&1 | tee -a "$DEPLOY_LOG"; then
    log "WARNING: Some images may not be available in GHCR. Falling back to local build."
    # If pull fails for some images, they'll be built locally
fi

# Start services with new images
log "Starting services..."
docker compose up -d

# Health check loop
log "Waiting for services to be healthy..."
HEALTHY=false
MAX_WAIT=300  # 5 minutes
WAIT_INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))

    # Check for unhealthy containers
    UNHEALTHY=$(docker compose ps --format json 2>/dev/null | jq -r 'select(.Health == "unhealthy") | .Name' 2>/dev/null | head -5 || echo "")

    if [ -z "$UNHEALTHY" ]; then
        # No unhealthy containers - check if any are still starting
        STARTING=$(docker compose ps --format json 2>/dev/null | jq -r 'select(.Health == "starting") | .Name' 2>/dev/null | head -5 || echo "")
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
    echo "$NEW_VERSION" > "$VERSION_FILE"
    notify "Deployment successful: ${NEW_VERSION:0:8}"
    cleanup_old_logs
else
    log "ERROR: Services unhealthy after ${MAX_WAIT}s"
    log "Unhealthy services:"
    docker compose ps | tee -a "$DEPLOY_LOG"

    notify "Deployment failed: Services unhealthy. Initiating rollback..."

    log "Initiating automatic rollback..."
    if "$SCRIPT_DIR/rollback.sh"; then
        notify "Rollback completed successfully"
    else
        notify "CRITICAL: Rollback also failed! Manual intervention required."
    fi
    exit 1
fi

log "Deployment complete."
