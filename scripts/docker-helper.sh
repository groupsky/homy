#!/bin/bash
# docker-helper.sh
# Helper script for docker-compose version compatibility and common utilities
# Source this script in other scripts with: source "$(dirname "$0")/docker-helper.sh"
#
# Minimum requirements:
# - Bash 3.0+
# - Git 1.8.5+
# - jq (for health checks and service status)
# - flock (for deployment locking)
# - curl (for notifications, optional)

set -euo pipefail

# Initialize project directories if not already set
# This is done automatically when the script is sourced
if [ -z "${SCRIPT_DIR:-}" ]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    export SCRIPT_DIR
fi

if [ -z "${PROJECT_DIR:-}" ]; then
    PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
    export PROJECT_DIR
fi

# Standard file paths
LOCK_FILE="${LOCK_FILE:-/var/lock/homy-deployment.lock}"
VERSION_FILE="${VERSION_FILE:-$PROJECT_DIR/.deployed-version}"
PREVIOUS_VERSION_FILE="${PREVIOUS_VERSION_FILE:-$PROJECT_DIR/.previous-version}"
BACKUP_REF_FILE="${BACKUP_REF_FILE:-$PROJECT_DIR/.pre-upgrade-backup}"

# Service state tracking for emergency restart
SERVICES_STOPPED="${SERVICES_STOPPED:-0}"

# Detect docker-compose command (with or without dash)
detect_docker_compose() {
    if command -v docker-compose &> /dev/null; then
        # Old version with dash (docker-compose 1.x)
        echo "docker-compose"
    elif docker compose version &> /dev/null; then
        # New version as plugin (docker compose 2.x)
        echo "docker compose"
    else
        echo "ERROR: Neither 'docker-compose' nor 'docker compose' command is available" >&2
        exit 1
    fi
}

# Global variable to store the docker-compose command
DOCKER_COMPOSE_CMD="${DOCKER_COMPOSE_CMD:-$(detect_docker_compose)}"

# Wrapper function for docker-compose commands
# Usage: dc_run [docker-compose args...]
# Example: dc_run ps --format json
dc_run() {
    $DOCKER_COMPOSE_CMD "$@"
}

# Logging function with timestamp
# Usage: log "message"
# If LOG_FILE is set, logs to both stdout and file
log() {
    if [ "${QUIET:-0}" -eq 0 ]; then
        local message="[$(date '+%Y-%m-%d %H:%M:%S')] $*"
        if [ -n "${LOG_FILE:-}" ]; then
            echo "$message" | tee -a "$LOG_FILE"
        else
            echo "$message"
        fi
    fi
}

# Confirmation prompt with y/N response
# Usage: if confirm "Are you sure?"; then ...; fi
# Respects YES_FLAG (-y) to skip prompts
confirm() {
    local prompt="$1"

    if [ "${YES_FLAG:-0}" -eq 1 ] || [ "${QUIET:-0}" -eq 1 ]; then
        return 0
    fi

    echo ""
    read -rp "$prompt [y/N] " response
    case "$response" in
        [yY][eE][sS]|[yY])
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

# Notification function for Telegram (optional)
# Usage: notify "message"
# Requires TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to be set
notify() {
    local message="$1"

    if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
        curl -s -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -d chat_id="${TELEGRAM_CHAT_ID}" \
            -d text="$message" \
            -d parse_mode="HTML" \
            > /dev/null 2>&1 || true
    fi
}

# Load Telegram notification secrets if available
# Usage: load_notification_secrets
load_notification_secrets() {
    local secrets_dir="${PROJECT_DIR:-$(pwd)}/secrets"

    if [ -f "$secrets_dir/telegram_bot_token" ]; then
        TELEGRAM_BOT_TOKEN=$(cat "$secrets_dir/telegram_bot_token")
        export TELEGRAM_BOT_TOKEN
    fi

    if [ -f "$secrets_dir/telegram_chat_id" ]; then
        TELEGRAM_CHAT_ID=$(cat "$secrets_dir/telegram_chat_id")
        export TELEGRAM_CHAT_ID
    fi
}

# Acquire deployment lock to prevent concurrent operations
# Usage: acquire_lock [SKIP_LOCK]
# Uses flock on /var/lock/homy-deployment.lock
# Pass 1 or set SKIP_LOCK=1 to skip locking (for internal script calls)
acquire_lock() {
    local skip_lock="${1:-${SKIP_LOCK:-0}}"
    local lock_name="${LOCK_NAME:-deployment}"

    if ! command -v flock &> /dev/null; then
        echo "ERROR: flock is required but not installed." >&2
        echo "Install with: apt-get install util-linux" >&2
        exit 1
    fi

    if [ "$skip_lock" -eq 0 ]; then
        exec 200>"$LOCK_FILE"

        if ! flock -n 200; then
            echo "ERROR: Another $lock_name operation is in progress" >&2
            echo "If you're sure no other operation is running, remove: $LOCK_FILE" >&2
            exit 1
        fi
    fi
}

# Validate backup name format
# Usage: validate_backup_name "backup_name"
# Returns 0 if valid, 1 if invalid
validate_backup_name() {
    local name="$1"

    # Check for invalid characters (only alphanumeric, underscore, dash allowed)
    if ! [[ "$name" =~ ^[a-zA-Z0-9_-]+$ ]]; then
        log "ERROR: Invalid backup name format. Only alphanumeric characters, underscores, and dashes are allowed."
        return 1
    fi

    # Prevent path traversal
    if [[ "$name" == *".."* ]] || [[ "$name" == *"/"* ]]; then
        log "ERROR: Invalid backup name. Path traversal characters are not allowed."
        return 1
    fi

    return 0
}

# Validate image tag format
# Usage: validate_image_tag "tag"
# Returns 0 if valid, 1 if invalid
validate_image_tag() {
    local tag="$1"

    # Allow git SHAs (40 hex chars), semantic versions, branch names, or 'latest'
    if [[ "$tag" =~ ^[0-9a-f]{40}$ ]] || \
       [[ "$tag" =~ ^v?[0-9]+\.[0-9]+\.[0-9]+(-[a-zA-Z0-9.-]+)?$ ]] || \
       [[ "$tag" =~ ^[a-zA-Z0-9/_-]+$ ]] || \
       [[ "$tag" == "latest" ]]; then
        return 0
    fi

    log "ERROR: Invalid image tag format: $tag"
    log "Allowed formats: git SHA, semantic version (v1.2.3), branch name, or 'latest'"
    return 1
}

# Check if services are running
# Usage: services_running
# Returns 0 if any services are running, 1 if all stopped
# Requires jq to be installed
services_running() {
    if ! command -v jq &> /dev/null; then
        log "ERROR: jq is required but not installed."
        return 2
    fi

    local running_count
    running_count=$(dc_run ps --format json | jq -s 'length')

    [ "$running_count" -gt 0 ]
}

# Wait for services to be healthy
# Usage: wait_for_health [TIMEOUT_SECONDS]
# Returns 0 if all services are healthy, 1 if timeout or failure
# Checks both unhealthy and starting states
wait_for_health() {
    local timeout="${1:-300}"  # Default 5 minutes
    local elapsed=0
    local check_interval=10

    if ! command -v jq &> /dev/null; then
        log "ERROR: jq is required but not installed."
        return 1
    fi

    log "Checking service health (timeout: ${timeout}s)..."

    local healthy=0

    while [ $elapsed -lt "$timeout" ]; do
        sleep $check_interval
        elapsed=$((elapsed + check_interval))

        # Check for unhealthy services using NDJSON parsing
        local unhealthy
        unhealthy=$(dc_run ps --format json 2>/dev/null | \
            jq -rs '[.[] | select(.Health == "unhealthy")] | .[].Name' 2>/dev/null | head -5 || echo "")

        if [ -z "$unhealthy" ]; then
            # No unhealthy services, check for starting services
            local starting
            starting=$(dc_run ps --format json 2>/dev/null | \
                jq -rs '[.[] | select(.Health == "starting")] | .[].Name' 2>/dev/null | head -5 || echo "")

            if [ -z "$starting" ]; then
                healthy=1
                break
            fi
            log "Waiting... still starting: $starting (${elapsed}s)"
        else
            log "Waiting... unhealthy: $unhealthy (${elapsed}s)"
        fi
    done

    if [ $healthy -eq 1 ]; then
        log "All services are healthy"
        return 0
    else
        log "ERROR: Health check timeout after ${timeout}s"
        return 1
    fi
}

# Atomic file write (write to temp then move)
# Usage: atomic_write "filename" "content"
atomic_write() {
    local filename="$1"
    local content="$2"

    echo "$content" > "${filename}.tmp"
    mv "${filename}.tmp" "$filename"
}

# Cleanup old log files, keeping only the most recent N
# Usage: cleanup_old_logs "log_dir" "pattern" MAX_KEEP
# Example: cleanup_old_logs "logs" "deploy-*.log" 30
cleanup_old_logs() {
    local log_dir="$1"
    local pattern="$2"
    local max_keep="${3:-30}"

    # Count matching files
    local log_count
    log_count=$(ls -1 "$log_dir"/$pattern 2>/dev/null | wc -l || echo "0")

    if [ "$log_count" -gt "$max_keep" ]; then
        log "Cleaning up old logs in $log_dir..."
        # Sort by modification time (newest first), skip first N, delete rest
        # Using ls -t for BSD/macOS compatibility (instead of find -printf)
        ls -1t "$log_dir"/$pattern 2>/dev/null | tail -n +$((max_keep + 1)) | xargs rm -f || true
    fi
}

# Require jq to be installed
# Usage: require_jq
require_jq() {
    if ! command -v jq &> /dev/null; then
        echo "ERROR: jq is required but not installed" >&2
        echo "Install with: apt-get install jq or brew install jq" >&2
        exit 1
    fi
}

# Require curl to be installed
# Usage: require_curl
require_curl() {
    if ! command -v curl &> /dev/null; then
        echo "ERROR: curl is required but not installed" >&2
        echo "Install with: apt-get install curl or brew install curl" >&2
        exit 1
    fi
}

# Validate docker-compose.yml exists in project root
# Usage: validate_compose_file
validate_compose_file() {
    if [ ! -f "$PROJECT_DIR/docker-compose.yml" ]; then
        echo "ERROR: docker-compose.yml not found. Not in project root?" >&2
        exit 1
    fi
}

# List available backups
# Usage: list_backups
list_backups() {
    echo "Available backups:"
    dc_run run --rm volman list
}

# Setup emergency restart trap for service recovery
# Usage: setup_emergency_restart
# Call this early in scripts that stop services
setup_emergency_restart() {
    cleanup() {
        local exit_code=$?
        if [ "${SERVICES_STOPPED:-0}" -eq 1 ]; then
            log "Script interrupted! Attempting to restart services..."
            dc_run up -d || true
            log "Emergency restart attempted. Check service status!"
        fi
        exit $exit_code
    }

    trap cleanup EXIT INT TERM
}

# Mark services as stopped (for emergency restart)
# Usage: mark_services_stopped
mark_services_stopped() {
    SERVICES_STOPPED=1
    export SERVICES_STOPPED
}

# Mark services as running (disable emergency restart)
# Usage: mark_services_running
mark_services_running() {
    SERVICES_STOPPED=0
    export SERVICES_STOPPED
}

# Get deployed version from file
# Usage: version=$(get_deployed_version)
get_deployed_version() {
    cat "$VERSION_FILE" 2>/dev/null || echo "unknown"
}

# Get previous version from file
# Usage: version=$(get_previous_version)
get_previous_version() {
    cat "$PREVIOUS_VERSION_FILE" 2>/dev/null || echo ""
}

# Save deployed version to file atomically
# Usage: save_deployed_version "version"
save_deployed_version() {
    local version="$1"
    atomic_write "$VERSION_FILE" "$version"
}

# Save previous version to file atomically
# Usage: save_previous_version "version"
save_previous_version() {
    local version="$1"
    atomic_write "$PREVIOUS_VERSION_FILE" "$version"
}

# Get backup reference from file
# Usage: backup=$(get_backup_reference)
get_backup_reference() {
    cat "$BACKUP_REF_FILE" 2>/dev/null || echo ""
}

# Save backup reference to file atomically
# Usage: save_backup_reference "backup_name"
save_backup_reference() {
    local backup_name="$1"
    atomic_write "$BACKUP_REF_FILE" "$backup_name"
}

# Get current git commit hash
# Usage: get_git_commit
get_git_commit() {
    git rev-parse HEAD 2>/dev/null || echo "unknown"
}

# Get current git branch
# Usage: get_git_branch
get_git_branch() {
    git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown"
}

# Check if running in detached HEAD state
# Usage: if is_detached_head; then ...; fi
is_detached_head() {
    local branch
    branch=$(get_git_branch)
    [ "$branch" = "HEAD" ]
}

# Export functions and variables for use in scripts
export -f dc_run
export -f log
export -f confirm
export -f notify
export -f load_notification_secrets
export -f acquire_lock
export -f validate_backup_name
export -f validate_image_tag
export -f services_running
export -f wait_for_health
export -f atomic_write
export -f cleanup_old_logs
export -f require_jq
export -f require_curl
export -f validate_compose_file
export -f list_backups
export -f setup_emergency_restart
export -f mark_services_stopped
export -f mark_services_running
export -f get_deployed_version
export -f get_previous_version
export -f save_deployed_version
export -f save_previous_version
export -f get_backup_reference
export -f save_backup_reference
export -f get_git_commit
export -f get_git_branch
export -f is_detached_head

export DOCKER_COMPOSE_CMD
export SCRIPT_DIR
export PROJECT_DIR
export LOCK_FILE
export VERSION_FILE
export PREVIOUS_VERSION_FILE
export BACKUP_REF_FILE
export SERVICES_STOPPED
