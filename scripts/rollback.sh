#!/bin/bash
#
# Rollback Script
#
# This script handles rollback to a previous deployment version,
# including database restoration from backup.
#

set -euo pipefail

# Lock file for preventing concurrent deployments
LOCK_FILE="/var/lock/homy-deployment.lock"
SKIP_LOCK=false

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION_FILE="$PROJECT_DIR/.deployed-version"
PREVIOUS_VERSION_FILE="$PROJECT_DIR/.previous-version"
BACKUP_REF_FILE="$PROJECT_DIR/.pre-upgrade-backup"
ROLLBACK_LOG="$PROJECT_DIR/logs/rollback-$(date +%Y%m%d-%H%M%S).log"

# Default values
BACKUP_NAME=""
LIST_BACKUPS=false
SKIP_CONFIRM=false

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [BACKUP_NAME]

Rollback the homy home automation system to a previous version.

Arguments:
  BACKUP_NAME         Name of backup to restore (format: YYYY_MM_DD_HH_MM_SS)
                      If not specified, uses the most recent pre-upgrade backup

Options:
  -h, --help          Show this help message and exit
  -l, --list          List available backups and exit
  -y, --yes           Skip confirmation prompt

Examples:
  $(basename "$0")                        # Rollback to most recent backup
  $(basename "$0") 2026_01_17_14_30_00    # Rollback to specific backup
  $(basename "$0") --list                 # List available backups
  $(basename "$0") -y                     # Rollback without confirmation

Warning:
  Rollback restores databases from backup. Any data written after the backup
  was created will be LOST. This includes sensor readings, state changes,
  and configuration modifications.

EOF
    exit 0
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -l|--list)
            LIST_BACKUPS=true
            shift
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        --no-lock)
            # Internal flag: skip lock acquisition when called from deploy.sh
            SKIP_LOCK=true
            shift
            ;;
        -*)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            BACKUP_NAME="$1"
            shift
            ;;
    esac
done

# Acquire lock if not skipped (internal flag for when called from deploy.sh)
if [ "$SKIP_LOCK" = false ]; then
    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
        echo "ERROR: Another deployment operation is in progress" >&2
        echo "If you're sure no other operation is running, remove: $LOCK_FILE" >&2
        exit 1
    fi
fi

# Ensure log directory exists
mkdir -p "$PROJECT_DIR/logs"

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
    "$SCRIPT_DIR/restore.sh" --list --no-lock
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

# Handle --list flag
if [ "$LIST_BACKUPS" = true ]; then
    list_backups
    exit 0
fi

log "Starting rollback..."
log "Project directory: $PROJECT_DIR"
log "Rollback log: $ROLLBACK_LOG"

# Determine what to rollback to
if [ -z "$BACKUP_NAME" ]; then
    BACKUP_NAME=$(cat "$BACKUP_REF_FILE" 2>/dev/null || echo "")
fi

if [ -z "$BACKUP_NAME" ]; then
    log "ERROR: No backup specified and no recent backup found"
    echo ""
    echo "Please specify a backup name or use --list to see available backups."
    echo ""
    list_backups
    exit 1
fi

# Validate backup name if provided by user
if [ -n "$BACKUP_NAME" ]; then
    # Allow only alphanumeric, underscore, dash
    if ! echo "$BACKUP_NAME" | grep -qE '^[a-zA-Z0-9_-]+$'; then
        echo "ERROR: Invalid backup name format: $BACKUP_NAME" >&2
        echo "Backup names must contain only: letters, numbers, dash (-), underscore (_)" >&2
        exit 1
    fi
    # Prevent path traversal
    if echo "$BACKUP_NAME" | grep -qE '\.\.|/'; then
        echo "ERROR: Backup name contains invalid characters (.. or /)" >&2
        exit 1
    fi
fi

log "Rolling back to backup: $BACKUP_NAME"

# Get current and previous versions
CURRENT_VERSION=$(cat "$VERSION_FILE" 2>/dev/null || echo "unknown")
log "Current version: $CURRENT_VERSION"

# Try to determine previous version
# First, check if we have it saved in the previous version file
PREV_VERSION=$(cat "$PREVIOUS_VERSION_FILE" 2>/dev/null || echo "")

if [ -z "$PREV_VERSION" ]; then
    # Fall back to git calculation
    log "No saved previous version, calculating from git history..."
    if [ "$CURRENT_VERSION" != "unknown" ] && [ ${#CURRENT_VERSION} -ge 7 ]; then
        # Current version is a git SHA, go back one commit
        PREV_VERSION=$(git rev-parse "$CURRENT_VERSION^" 2>/dev/null || echo "latest")
    else
        PREV_VERSION="latest"
    fi
else
    log "Using saved previous version"
fi

log "Previous version: $PREV_VERSION"

# Show rollback plan and ask for confirmation
echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                      ROLLBACK PLAN"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Current version:  $CURRENT_VERSION"
echo "  Target version:   $PREV_VERSION"
echo "  Backup to restore: $BACKUP_NAME"
echo ""
echo "  This will:"
echo "    1. Stop all services"
echo "    2. Restore databases from backup"
echo "    3. Pull previous version images"
echo "    4. Start services with previous version"
echo "    5. Verify health"
echo ""
echo "  ⚠️  WARNING: Any data written after the backup will be LOST!"
echo "     This includes sensor readings, state changes, and configs."
echo ""
echo "═══════════════════════════════════════════════════════════════"

if ! confirm "Proceed with rollback?"; then
    log "Rollback cancelled by user"
    exit 0
fi

# Stop current services
log "Stopping services..."
docker compose stop
SERVICES_STOPPED=true

# Restore database backup using restore.sh (services already stopped, don't start after)
log "Restoring databases from backup: $BACKUP_NAME"
if ! "$SCRIPT_DIR/restore.sh" --yes --quiet --no-lock "$BACKUP_NAME"; then
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
    # Validate git reference before checkout
    if ! git rev-parse --verify "${PREV_VERSION}^{commit}" >/dev/null 2>&1; then
        log "ERROR: Invalid git reference: $PREV_VERSION"
        log "Cannot proceed with rollback"
        exit 1
    fi

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
SERVICES_STOPPED=false

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

# Check final health status and update version accordingly
if [ "$HEALTHY" = true ]; then
    # Update version file
    echo "$PREV_VERSION" > "${VERSION_FILE}.tmp"
    mv "${VERSION_FILE}.tmp" "$VERSION_FILE"

    log "Rollback complete."
    log ""
    log "Services are healthy."

    notify "Rollback completed successfully to $BACKUP_NAME (version: ${PREV_VERSION:0:8})"
else
    log "ERROR: Rollback health check failed after ${MAX_WAIT}s"
    log "Services status:"
    docker compose ps | tee -a "$ROLLBACK_LOG"

    notify "CRITICAL: Rollback to $BACKUP_NAME FAILED - services unhealthy"

    log ""
    log "IMPORTANT: System may be in inconsistent state."
    log "Manual intervention required. Check service logs."
    exit 1
fi
