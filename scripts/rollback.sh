#!/bin/bash
#
# Rollback Script
#
# This script handles rollback to a previous deployment version,
# including database restoration from a volman backup. It stops the whole
# stack and throws away everything written since that backup.
#
# deploy.sh does not call it: a failed deploy rolls back code and images
# only, and data from a deploy snapshot is restored with restore-snapshot.sh.
#

set -euo pipefail

# Source the docker-helper.sh for common functions
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

# Tags the Telegram log line (journalctl -t homy-rollback); deploy.sh keeps homy-deploy
NOTIFY_SENDER=homy-rollback

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
Usage: $(basename "$0") [OPTIONS] BACKUP_NAME

Rollback the homy home automation system to a previous version.

Arguments:
  BACKUP_NAME         Name of the backup to restore (format: YYYY_MM_DD_HH_MM_SS).
                      Required: the stack is restored to that moment, and every
                      write since is lost (InfluxDB alone is ~100 GB)

Options:
  -h, --help          Show this help message and exit
  -l, --list          List available backups and exit
  -y, --yes           Skip confirmation prompt
  --no-lock           Do not take the deployment lock (only when the caller
                      already holds it)

Examples:
  $(basename "$0") 2026_01_17_14_30_00    # Rollback to specific backup
  $(basename "$0") --list                 # List available backups
  $(basename "$0") -y 2026_01_17_14_30_00 # Rollback without confirmation

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
# No default: .pre-upgrade-backup can be weeks older than the version in
# .previous-version, and restoring it would silently throw all of that away
if [ -z "$BACKUP_NAME" ]; then
    error "Name the backup to restore: rollback.sh BACKUP_NAME (see rollback.sh --list)"
    echo "Everything written since that backup is lost. For one service, prefer scripts/restore-snapshot.sh." >&2
    exit 1
fi

# Validate backup name if provided by user
validate_backup_or_exit "$BACKUP_NAME"

log "Rolling back to backup: $BACKUP_NAME"

# Get current and previous versions
CURRENT_VERSION=$(get_deployed_version)
log "Current version: $CURRENT_VERSION"

# Determine previous version
PREV_VERSION=$(determine_previous_version "$CURRENT_VERSION")
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
    error "Backup restoration failed"
    log "Attempting to start services without database restoration..."
    notify "CRITICAL: Rollback backup restoration failed. Attempting service recovery..."
    # Start the existing containers again - better than leaving the system down.
    # `start`, not `up`: up would recreate them from the current compose files
    dc_timeout start || true
    # Started already: keep the EXIT trap from starting them a second time
    mark_services_running
    exit 1
fi
log "Database restoration complete"

# Reset code to previous commit if we know the version
if [ "$PREV_VERSION" != "latest" ]; then
    log "Resetting code to previous version..."
    checkout_git_version "$PREV_VERSION" "$ROLLBACK_LOG" || true
fi

# Pull previous version images
export IMAGE_TAG="$PREV_VERSION"
log "Using IMAGE_TAG: $IMAGE_TAG"

# The deploy override pins the images of the version being rolled back from;
# go by IMAGE_TAG instead, and drop the stale pins (the next deploy writes new ones)
rm -f "$DEPLOY_OVERRIDE_FILE"

log "Pulling previous version images..."
if ! dc_base pull 2>&1 | tee -a "$ROLLBACK_LOG"; then
    log "WARNING: Some images may not be available; up will fail for any image missing on this host (it never builds)."
fi

# Start services
log "Starting services with previous version..."
UP_OK=1
if ! COMPOSE_FILE="$(compose_base_files)" dc_timeout up -d --no-build --pull never 2>&1 | tee -a "$ROLLBACK_LOG"; then
    error "Starting the previous version failed"
    UP_OK=0
fi
mark_services_running

# Health gate over the whole stack (it was all restarted). A failed up is a
# failed rollback even when what did start is healthy.
log "Verifying rollback health..."
if [ "$UP_OK" -eq 1 ] && wait_for_health; then
    # Update version file
    save_deployed_version "$PREV_VERSION"

    log "Rollback complete."
    log ""
    log "Services are healthy."

    notify "Rollback completed successfully to $BACKUP_NAME (version: $(format_version_short "$PREV_VERSION"))"
else
    error "Rollback health check failed"
    log "Services status:"
    dc_run ps | tee -a "$ROLLBACK_LOG"

    notify "CRITICAL: Rollback to $BACKUP_NAME FAILED - services unhealthy"

    log ""
    log "IMPORTANT: System may be in inconsistent state."
    log "Manual intervention required. Check service logs."
    exit 1
fi
