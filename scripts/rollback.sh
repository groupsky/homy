#!/bin/bash
#
# Rollback Script
#
# This script handles rollback to a previous deployment version,
# including database restoration from backup.
#
# Usage:
#   ./scripts/rollback.sh                    # Use most recent pre-upgrade backup
#   ./scripts/rollback.sh 2026_01_17_14_30   # Use specific backup
#   ./scripts/rollback.sh --list             # List available backups
#

set -euo pipefail

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$PROJECT_DIR/.deployed-version"
BACKUP_REF_FILE="$PROJECT_DIR/.pre-upgrade-backup"
ROLLBACK_LOG="$PROJECT_DIR/logs/rollback-$(date +%Y%m%d-%H%M%S).log"

# Ensure log directory exists
mkdir -p "$PROJECT_DIR/logs"

# Load secrets for notifications (optional)
TELEGRAM_TOKEN=""
TELEGRAM_CHAT_ID=""
[ -f "$PROJECT_DIR/secrets/telegram_bot_token" ] && TELEGRAM_TOKEN=$(cat "$PROJECT_DIR/secrets/telegram_bot_token")
[ -f "$PROJECT_DIR/secrets/telegram_chat_id" ] && TELEGRAM_CHAT_ID=$(cat "$PROJECT_DIR/secrets/telegram_chat_id")

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$ROLLBACK_LOG"
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

list_backups() {
    log "Available backups:"
    docker compose run --rm volman list | tee -a "$ROLLBACK_LOG"
}

# Change to project directory
cd "$PROJECT_DIR"

# Handle --list flag
if [ "${1:-}" = "--list" ]; then
    list_backups
    exit 0
fi

log "Starting rollback..."
log "Project directory: $PROJECT_DIR"
log "Rollback log: $ROLLBACK_LOG"

# Determine what to rollback to
BACKUP_NAME="${1:-$(cat "$BACKUP_REF_FILE" 2>/dev/null || echo "")}"
if [ -z "$BACKUP_NAME" ]; then
    log "ERROR: No backup specified and no recent backup found"
    log "Usage: $0 [backup_name]"
    log ""
    list_backups
    exit 1
fi

log "Rolling back to backup: $BACKUP_NAME"

# Get previous version from git history
# We'll go back one commit from current HEAD
CURRENT_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "unknown")
log "Current version: $CURRENT_VERSION"

# Try to determine previous version
if [ "$CURRENT_VERSION" != "unknown" ] && [ ${#CURRENT_VERSION} -ge 7 ]; then
    # Current version is a git SHA, go back one commit
    PREV_VERSION=$(git rev-parse "$CURRENT_VERSION^" 2>/dev/null || echo "latest")
else
    PREV_VERSION="latest"
fi
log "Previous version: $PREV_VERSION"

# Stop current services
log "Stopping services..."
docker compose down

# Restore database backup
log "Restoring databases from backup: $BACKUP_NAME"
if ! docker compose run --rm volman restore "$BACKUP_NAME"; then
    log "ERROR: Backup restoration failed"
    log "Attempting to start services without database restoration..."
    notify "CRITICAL: Rollback backup restoration failed. Attempting service recovery..."
    # Try to start services anyway - better than leaving system completely down
    docker compose up -d || true
    exit 1
fi
log "Database restoration complete"

# Reset code to previous commit if we know the version
if [ "$PREV_VERSION" != "latest" ]; then
    log "Resetting code to previous version..."
    log "WARNING: This will put the repository in detached HEAD state"
    if ! git checkout "$PREV_VERSION" 2>&1 | tee -a "$ROLLBACK_LOG"; then
        log "WARNING: git checkout failed. Trying with --force..."
        if ! git checkout --force "$PREV_VERSION" 2>&1 | tee -a "$ROLLBACK_LOG"; then
            log "WARNING: Could not checkout previous version. Continuing with current code."
        fi
    fi
fi

# Pull previous version images
export IMAGE_TAG="$PREV_VERSION"
log "Using IMAGE_TAG: $IMAGE_TAG"

log "Pulling previous version images..."
if ! docker compose pull 2>&1 | tee -a "$ROLLBACK_LOG"; then
    log "WARNING: Some images may not be available. Will use local build."
fi

# Start services
log "Starting services with previous version..."
docker compose up -d

# Health check loop (shorter than deploy since this is recovery)
log "Verifying rollback health..."
HEALTHY=false
MAX_WAIT=120  # 2 minutes for rollback verification
WAIT_INTERVAL=10
ELAPSED=0

while [ $ELAPSED -lt $MAX_WAIT ]; do
    sleep $WAIT_INTERVAL
    ELAPSED=$((ELAPSED + WAIT_INTERVAL))

    # docker compose ps --format json outputs NDJSON
    UNHEALTHY=$(docker compose ps --format json 2>/dev/null | jq -rs '[.[] | select(.Health == "unhealthy" or .State == "exited")] | .[].Name' 2>/dev/null | head -5 || echo "")

    if [ -z "$UNHEALTHY" ]; then
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

# Check service status
log "Service status after rollback:"
docker compose ps | tee -a "$ROLLBACK_LOG"

# Count running services (NDJSON format)
RUNNING=$(docker compose ps --format json 2>/dev/null | jq -rs '[.[] | select(.State == "running")] | length' || echo "0")
TOTAL=$(docker compose ps --format json 2>/dev/null | jq -rs 'length' || echo "0")

log "Running services: $RUNNING / $TOTAL"

# Update version file
echo "$PREV_VERSION" > "$VERSION_FILE"

log "Rollback complete."
log ""
log "IMPORTANT: Review the service status above."
log "Some data written between the backup and now may have been lost."
log ""

notify "Rollback completed to $BACKUP_NAME (version: ${PREV_VERSION:0:8})"
