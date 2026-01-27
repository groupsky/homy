#!/bin/bash
#
# Restore Script
#
# Restores databases from a backup (InfluxDB, MongoDB, Home Assistant).
#

set -euo pipefail

# Source helper functions
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
BACKUP_NAME=$(determine_backup_name "$BACKUP_NAME") || exit 1

# Validate backup name if provided by user
validate_backup_or_exit "$BACKUP_NAME"

# Validate jq is installed and check if services are running
require_jq
require_services_stopped || exit 1

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
    error "Restore failed for backup: $BACKUP_NAME"
    exit 1
fi

log "Restore complete."

# Start services if requested
if [ "$START_SERVICES" -eq 1 ]; then
    log "Starting services..."
    dc_run up -d
    log "Services started."
fi
