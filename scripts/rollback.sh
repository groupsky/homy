#!/bin/bash
#
# Rollback Script
#
# This script handles rollback to a previous deployment version,
# including database restoration from backup.
#

set -euo pipefail

# Source the docker-helper.sh for common functions
source "$(dirname "$0")/docker-helper.sh"

# Lock file control
SKIP_LOCK=0

# Log file configuration
ROLLBACK_LOG="$PROJECT_DIR/logs/rollback-$(date +%Y%m%d-%H%M%S).log"
LOG_FILE="$ROLLBACK_LOG"

# Default values
BACKUP_NAME=""
LIST_BACKUPS=0
YES_FLAG=0

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
            LIST_BACKUPS=1
            shift
            ;;
        -y|--yes)
            YES_FLAG=1
            shift
            ;;
        --no-lock)
            # Internal flag: skip lock acquisition when called from deploy.sh
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

# Acquire lock if not skipped (internal flag for when called from deploy.sh)
acquire_lock "$SKIP_LOCK"

# Ensure log directory exists
mkdir -p "$PROJECT_DIR/logs"

# Setup emergency restart trap
setup_emergency_restart

# Load secrets for notifications (optional)
load_notification_secrets

# Change to project directory
cd "$PROJECT_DIR"

# Handle --list flag
if [ "$LIST_BACKUPS" -eq 1 ]; then
    list_backups
    exit 0
fi

log "Starting rollback..."
log "Project directory: $PROJECT_DIR"
log "Rollback log: $ROLLBACK_LOG"

# Determine what to rollback to
if [ -z "$BACKUP_NAME" ]; then
    BACKUP_NAME=$(get_backup_reference)
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
    if ! validate_backup_name "$BACKUP_NAME"; then
        echo "ERROR: Invalid backup name format: $BACKUP_NAME" >&2
        echo "Backup names must contain only: letters, numbers, dash (-), underscore (_)" >&2
        exit 1
    fi
fi

log "Rolling back to backup: $BACKUP_NAME"

# Get current and previous versions
CURRENT_VERSION=$(get_deployed_version)
log "Current version: $CURRENT_VERSION"

# Try to determine previous version
# First, check if we have it saved in the previous version file
PREV_VERSION=$(get_previous_version)

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
dc_run stop
mark_services_stopped

# Restore database backup using restore.sh (services already stopped, don't start after)
log "Restoring databases from backup: $BACKUP_NAME"
if ! "$SCRIPT_DIR/restore.sh" --yes --quiet --no-lock "$BACKUP_NAME"; then
    log "ERROR: Backup restoration failed"
    log "Attempting to start services without database restoration..."
    notify "CRITICAL: Rollback backup restoration failed. Attempting service recovery..."
    # Try to start services anyway - better than leaving system completely down
    dc_run up -d || true
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
if ! dc_run pull 2>&1 | tee -a "$ROLLBACK_LOG"; then
    log "WARNING: Some images may not be available. Will use local build."
fi

# Start services
log "Starting services with previous version..."
dc_run up -d
mark_services_running

# Health check with shorter timeout (2 minutes for rollback verification)
log "Verifying rollback health..."
if wait_for_health 120; then
    # Update version file
    save_deployed_version "$PREV_VERSION"

    log "Rollback complete."
    log ""
    log "Services are healthy."

    notify "Rollback completed successfully to $BACKUP_NAME (version: ${PREV_VERSION:0:8})"
else
    log "ERROR: Rollback health check failed after 120s"
    log "Services status:"
    dc_run ps | tee -a "$ROLLBACK_LOG"

    notify "CRITICAL: Rollback to $BACKUP_NAME FAILED - services unhealthy"

    log ""
    log "IMPORTANT: System may be in inconsistent state."
    log "Manual intervention required. Check service logs."
    exit 1
fi
