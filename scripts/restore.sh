#!/bin/bash
#
# Restore Script
#
# Restores databases from a backup (InfluxDB, MongoDB, Home Assistant).
#

set -euo pipefail

# Source helper functions
source "$(dirname "$0")/docker-helper.sh"

# Lock file for preventing concurrent deployments
SKIP_LOCK=0

# Default values
BACKUP_NAME=""
LIST_BACKUPS=0
YES_FLAG=0
QUIET=0
START_SERVICES=0

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
            LIST_BACKUPS=1
            shift
            ;;
        -s|--start)
            START_SERVICES=1
            shift
            ;;
        -y|--yes)
            YES_FLAG=1
            shift
            ;;
        -q|--quiet)
            QUIET=1
            YES_FLAG=1
            shift
            ;;
        --no-lock)
            # Internal flag: skip lock acquisition when called from deploy.sh/rollback.sh
            SKIP_LOCK=1
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
acquire_lock "$SKIP_LOCK"

# Change to project directory
cd "$PROJECT_DIR"

# Validate docker-compose.yml exists
validate_compose_file

# Handle --list flag
if [ "$LIST_BACKUPS" -eq 1 ]; then
    list_backups
    exit 0
fi

# Determine backup name
if [ -z "$BACKUP_NAME" ]; then
    BACKUP_NAME=$(get_backup_reference)
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
    if ! validate_backup_name "$BACKUP_NAME"; then
        echo "ERROR: Invalid backup name format: $BACKUP_NAME" >&2
        echo "Backup names must contain only: letters, numbers, dash (-), underscore (_)" >&2
        exit 1
    fi
fi

# Validate jq is installed
require_jq

# Check if services are running
RUNNING_SERVICES=$(dc_run ps --format json 2>/dev/null | jq -rs '[.[] | select(.State == "running")] | length' || echo "0")
if [ "$RUNNING_SERVICES" -gt 0 ]; then
    echo "ERROR: Services are still running. Stop them first:" >&2
    echo "  docker compose down" >&2
    echo ""
    echo "Or use deploy.sh/rollback.sh which handle this automatically." >&2
    exit 1
fi

# Show restore plan
if [ "$QUIET" -eq 0 ]; then
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
if ! dc_run run --rm volman restore "$BACKUP_NAME"; then
    echo "ERROR: Restore failed" >&2
    exit 1
fi

log "Restore complete."

# Start services if requested
if [ "$START_SERVICES" -eq 1 ]; then
    log "Starting services..."
    dc_run up -d
    log "Services started."
fi
