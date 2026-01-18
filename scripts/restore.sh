#!/bin/bash
#
# Restore Script
#
# Restores databases from a backup (InfluxDB, MongoDB, Home Assistant).
#

set -euo pipefail

# Lock file for preventing concurrent deployments
LOCK_FILE="/var/lock/homy-deployment.lock"
SKIP_LOCK=false

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
BACKUP_REF_FILE="$PROJECT_DIR/.pre-upgrade-backup"

# Default values
BACKUP_NAME=""
LIST_BACKUPS=false
SKIP_CONFIRM=false
QUIET=false
START_SERVICES=false

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [BACKUP_NAME]

Restore databases from a backup (InfluxDB, MongoDB, Home Assistant).

Arguments:
  BACKUP_NAME         Name of backup to restore (format: YYYY_MM_DD_HH_MM_SS)
                      If not specified, uses the most recent pre-upgrade backup

Options:
  -h, --help          Show this help message and exit
  -l, --list          List available backups and exit
  -s, --start         Start services after restore
  -y, --yes           Skip confirmation prompt
  -q, --quiet         Suppress output except errors (for scripting)

Examples:
  $(basename "$0") --list                     # List available backups
  $(basename "$0") 2026_01_17_14_30_00        # Restore specific backup
  $(basename "$0")                            # Restore most recent backup
  $(basename "$0") -s -y                      # Restore and start services

Warning:
  - Services must be stopped before restore
  - Any data written after the backup will be LOST
  - This includes sensor readings, state changes, and configs

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
        -s|--start)
            START_SERVICES=true
            shift
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        -q|--quiet)
            QUIET=true
            SKIP_CONFIRM=true
            shift
            ;;
        --no-lock)
            # Internal flag: skip lock acquisition when called from deploy.sh/rollback.sh
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

# Acquire lock if not skipped (internal flag for when called from deploy.sh/rollback.sh)
if [ "$SKIP_LOCK" = false ]; then
    exec 200>"$LOCK_FILE"
    if ! flock -n 200; then
        echo "ERROR: Another deployment operation is in progress" >&2
        echo "If you're sure no other operation is running, remove: $LOCK_FILE" >&2
        exit 1
    fi
fi

log() {
    if [ "$QUIET" = false ]; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
    fi
}

list_backups() {
    echo "Available backups:"
    docker compose run --rm volman list
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

if [ ! -f docker-compose.yml ]; then
    echo "ERROR: docker-compose.yml not found. Not in project root?" >&2
    exit 1
fi

# Handle --list flag
if [ "$LIST_BACKUPS" = true ]; then
    list_backups
    exit 0
fi

# Determine backup name
if [ -z "$BACKUP_NAME" ]; then
    BACKUP_NAME=$(cat "$BACKUP_REF_FILE" 2>/dev/null || echo "")
fi

if [ -z "$BACKUP_NAME" ]; then
    echo "ERROR: No backup specified and no recent backup found" >&2
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

# Validate jq is installed
if ! command -v jq >/dev/null 2>&1; then
    echo "ERROR: jq is required but not installed" >&2
    echo "Install with: apt-get install jq or brew install jq" >&2
    exit 1
fi

# Check if services are running
RUNNING_SERVICES=$(docker compose ps --format json 2>/dev/null | jq -rs '[.[] | select(.State == "running")] | length' || echo "0")
if [ "$RUNNING_SERVICES" -gt 0 ]; then
    echo "ERROR: Services are still running. Stop them first:" >&2
    echo "  docker compose down" >&2
    echo ""
    echo "Or use deploy.sh/rollback.sh which handle this automatically." >&2
    exit 1
fi

# Show restore plan
if [ "$QUIET" = false ]; then
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "                       RESTORE PLAN"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    echo "  Backup to restore: $BACKUP_NAME"
    echo "  Start services:    $START_SERVICES"
    echo ""
    echo "  This will restore:"
    echo "    - InfluxDB data"
    echo "    - MongoDB data"
    echo "    - Home Assistant configuration"
    echo ""
    echo "  ⚠️  WARNING: Any data written after the backup will be LOST!"
    echo "     This includes sensor readings, state changes, and configs."
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
fi

if ! confirm "Proceed with restore?"; then
    log "Restore cancelled by user"
    exit 0
fi

# Run restore
log "Restoring from backup: $BACKUP_NAME"
if ! docker compose run --rm volman restore "$BACKUP_NAME"; then
    echo "ERROR: Restore failed" >&2
    exit 1
fi

log "Restore complete."

# Start services if requested
if [ "$START_SERVICES" = true ]; then
    log "Starting services..."
    docker compose up -d
    log "Services started."
fi
