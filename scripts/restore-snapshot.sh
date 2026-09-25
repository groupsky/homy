#!/bin/bash
#
# Restore service data from a deploy snapshot (manual)
#
# Copies the data directories of the named services back from a
# homy-deploy- ZFS snapshot. Only the services that use those directories are
# stopped, and they are started again afterwards. The current data is not
# deleted: each directory is first renamed to <dir>.pre-restore-<time>, so the
# restore can itself be undone. Delete those copies by hand once satisfied.
#
# It never rolls back the dataset: the dataset holds more than this stack.
#
# Run as root (the data belongs to several service users, and cp -a must keep
# the owners): sudo scripts/restore-snapshot.sh ...
#

set -euo pipefail

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

SKIP_LOCK=0
YES_FLAG=0
QUIET=0
LIST=0
NO_START=0
SNAPSHOT=""
SERVICES=()

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] SERVICE...

Copy the data directories of SERVICE... back from a deploy snapshot.

Options:
  -h, --help            Show this help message and exit
  -l, --list            List the deploy snapshots and exit
  --snapshot NAME       Snapshot to restore from (<dataset>@homy-deploy-...)
                        Default: the one the last deploy took (.pre-deploy-snapshot)
  --no-start            Leave the services stopped afterwards (for example to
                        start them on an older image with deploy.sh)
  -y, --yes             Do not ask for confirmation
  --no-lock             Do not take the deployment lock (only when the caller
                        already holds it)

Examples:
  sudo $(basename "$0") --list
  sudo $(basename "$0") ha
  sudo $(basename "$0") --snapshot tank/homy@homy-deploy-20260925T101500Z-abc1234 influxdb mongo

Only the services that mount the restored directories are stopped. The
current data is kept beside it as <dir>.pre-restore-<time>.
EOF
    exit 0
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage
            ;;
        -l|--list)
            LIST=1
            shift
            ;;
        --snapshot)
            SNAPSHOT="${2:-}"
            shift 2
            ;;
        -y|--yes)
            YES_FLAG=1
            shift
            ;;
        --no-start)
            NO_START=1
            shift
            ;;
        --no-lock)
            SKIP_LOCK=1
            shift
            ;;
        -*)
            echo "Unknown option: $1"
            echo "Use --help for usage information"
            exit 1
            ;;
        *)
            SERVICES+=("$1")
            shift
            ;;
    esac
done

cd "$PROJECT_DIR"
validate_compose_file
require_jq

if ! command -v zfs &> /dev/null; then
    error "No zfs command on this host; there are no deploy snapshots to restore from"
    exit 1
fi

if [ "$LIST" -eq 1 ]; then
    echo "Deploy snapshots (oldest first):"
    zfs list -H -t snapshot -o name,creation -s creation | grep -F "@homy-deploy-" || echo "  (none)"
    exit 0
fi

if [ "${#SERVICES[@]}" -eq 0 ]; then
    error "Name at least one service to restore (for example: ha influxdb)"
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    error "Run as root (sudo): the data belongs to several service users and must keep its owners"
    exit 1
fi

acquire_lock "$SKIP_LOCK"

if [ -z "$SNAPSHOT" ]; then
    SNAPSHOT=$(cat "$SNAPSHOT_REF_FILE" 2>/dev/null || true)
    if [ -z "$SNAPSHOT" ]; then
        error "No --snapshot given and no deploy snapshot recorded in $SNAPSHOT_REF_FILE"
        exit 1
    fi
fi

if ! [[ "$SNAPSHOT" =~ ^[A-Za-z0-9_.:/-]+@homy-deploy-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9._-]+$ ]]; then
    error "Not a deploy snapshot name: $SNAPSHOT"
    exit 1
fi
if [ "$(zfs list -H -t snapshot -o name "$SNAPSHOT" 2>/dev/null)" != "$SNAPSHOT" ]; then
    error "Snapshot $SNAPSHOT does not exist"
    exit 1
fi

DATASET="${SNAPSHOT%@*}"
SNAP="${SNAPSHOT#*@}"
if ! MOUNTPOINT=$(zfs get -H -o value mountpoint "$DATASET" 2>/dev/null) || [[ "$MOUNTPOINT" != /* ]]; then
    error "Dataset $DATASET has no mountpoint"
    exit 1
fi
MOUNTPOINT="${MOUNTPOINT%/}"
SNAPDIR="$MOUNTPOINT/.zfs/snapshot/$SNAP"

CONFIG=$(mktemp)
trap 'rm -f "$CONFIG"' EXIT
if ! dc_run config --format json > "$CONFIG"; then
    error "Could not read the compose config"
    exit 1
fi

# The directories to restore: the persistent mounts of the named services
mapfile -t ALL_MOUNTS < <(persistent_mounts "$CONFIG")
DIRS=()
for svc in "${SERVICES[@]}"; do
    if ! jq -e --arg s "$svc" '.services[$s]' "$CONFIG" > /dev/null; then
        error "No service named $svc in the compose config"
        exit 1
    fi
    found=0
    for entry in "${ALL_MOUNTS[@]}"; do
        [ "${entry%%$'\t'*}" = "$svc" ] || continue
        found=1
        DIRS+=("${entry#*$'\t'}")
    done
    if [ "$found" -eq 0 ]; then
        error "$svc has no data directory to restore"
        exit 1
    fi
done
mapfile -t DIRS < <(printf '%s\n' "${DIRS[@]}" | LC_ALL=C sort -u)

# Each directory must be on the snapshot's own dataset. On a child dataset,
# the parent's snapshot holds only an empty directory there.
REAL_MOUNTPOINT=$(realpath "$MOUNTPOINT")
for i in "${!DIRS[@]}"; do
    dir="${DIRS[$i]}"
    real=$(realpath -m "$dir")
    case "$real" in
        "$REAL_MOUNTPOINT"/*) ;;
        *)
            error "$dir is not on dataset $DATASET (mounted at $MOUNTPOINT)"
            exit 1
            ;;
    esac
    if [ -e "$dir" ] && [ "$(zfs list -H -o name "$dir" 2>/dev/null)" != "$DATASET" ]; then
        error "$dir is on another dataset than $DATASET; its data is not in this snapshot"
        exit 1
    fi
    # Work on the real path from here on (a symlinked path is fine)
    DIRS[$i]="$MOUNTPOINT/${real#"$REAL_MOUNTPOINT"/}"
    dir="${DIRS[$i]}"
    if [ ! -d "$SNAPDIR/${dir#"$MOUNTPOINT"/}" ]; then
        error "$dir is not in snapshot $SNAPSHOT"
        exit 1
    fi
done

# Every long-running service that mounts one of those directories must stop
AFFECTED=()
for entry in "${ALL_MOUNTS[@]}"; do
    svc="${entry%%$'\t'*}"
    src=$(realpath -m "${entry#*$'\t'}")
    for dir in "${DIRS[@]}"; do
        dir=$(realpath -m "$dir")
        if [ "$src" = "$dir" ] || [[ "$src" == "$dir"/* ]] || [[ "$dir" == "$src"/* ]]; then
            AFFECTED+=("$svc")
        fi
    done
done
mapfile -t AFFECTED < <(printf '%s\n' "${AFFECTED[@]}" | LC_ALL=C sort -u)

# Refuse when the copies would not fit: filling the pool would take the rest
# of the stack down with it
need_kb=0
for dir in "${DIRS[@]}"; do
    if ! kb=$(du -sk "$SNAPDIR/${dir#"$MOUNTPOINT"/}" | cut -f1); then
        error "Cannot read the snapshot's copy of $dir (run as root)"
        exit 1
    fi
    need_kb=$((need_kb + kb))
done
if ! avail=$(zfs list -H -p -o avail "$DATASET" 2>/dev/null) || ! [[ "$avail" =~ ^[0-9]+$ ]]; then
    error "Could not read the free space of $DATASET"
    exit 1
fi
if [ "$((need_kb * 1024))" -ge "$avail" ]; then
    error "The copies need $((need_kb / 1024)) MiB but $DATASET has only $((avail / 1024 / 1024)) MiB free"
    exit 1
fi

STAMP=$(date -u +%Y%m%dT%H%M%SZ)

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                  RESTORE FROM DEPLOY SNAPSHOT"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  Snapshot:  $SNAPSHOT"
echo "  Services to stop and start again: ${AFFECTED[*]}"
echo ""
echo "  Directories to restore:"
for dir in "${DIRS[@]}"; do
    echo "    $dir"
    echo "      current data kept as $dir.pre-restore-$STAMP"
done
if [ "$NO_START" -eq 1 ]; then
    echo ""
    echo "  The services stay stopped afterwards (--no-start)."
fi
echo ""
echo "  WARNING: everything these services wrote since the snapshot is"
echo "  replaced by the snapshot's copy."
echo ""
echo "═══════════════════════════════════════════════════════════════"

if ! confirm "Restore these directories from $SNAPSHOT?"; then
    log "Restore cancelled; nothing was changed"
    exit 0
fi

log "Stopping: ${AFFECTED[*]}"
if ! dc_run stop "${AFFECTED[@]}"; then
    error "Could not stop ${AFFECTED[*]}; nothing was restored"
    dc_timeout start "${AFFECTED[@]}" || true
    exit 1
fi

# Do not touch the data while any of them still runs
still_running=()
for svc in "${AFFECTED[@]}"; do
    if [ -n "$(dc_run ps -q "$svc" 2>/dev/null)" ]; then
        still_running+=("$svc")
    fi
done
if [ "${#still_running[@]}" -gt 0 ]; then
    error "Still running after stop: ${still_running[*]}; nothing was restored"
    dc_timeout start "${AFFECTED[@]}" || true
    exit 1
fi

RESTORED=()
restore_failed=0
# Interrupted between moving a directory aside and copying it back: leave the
# services stopped and say where things are
trap 'error "Interrupted. Services left stopped: ${AFFECTED[*]}. Current data is in <dir>.pre-restore-$STAMP; check each directory before starting them."; exit 130' INT TERM HUP
for dir in "${DIRS[@]}"; do
    src="$SNAPDIR/${dir#"$MOUNTPOINT"/}"
    aside="$dir.pre-restore-$STAMP"
    log "Restoring $dir from $SNAPSHOT"
    if [ -e "$dir" ] && ! mv "$dir" "$aside"; then
        error "Could not move $dir aside"
        restore_failed=1
        break
    fi
    if ! cp -a "$src" "$dir"; then
        error "Copy of $src failed"
        # Put the current data back; keep the partial copy for inspection
        if [ -e "$dir" ]; then
            mv "$dir" "$dir.failed-restore-$STAMP" || true
        fi
        if [ -e "$aside" ]; then
            mv "$aside" "$dir" || error "Could not move $aside back to $dir: do it by hand"
        fi
        restore_failed=1
        break
    fi
    RESTORED+=("$dir")
done

trap - INT TERM HUP

if [ "$restore_failed" -ne 0 ]; then
    # Some directories may be restored and others not: do not start services
    # on a mix
    error "Restore did not complete. Restored: ${RESTORED[*]:-none}. Services left stopped: ${AFFECTED[*]}"
    exit 1
fi

if [ "$NO_START" -eq 1 ]; then
    log "Left stopped (--no-start): ${AFFECTED[*]}"
else
    log "Starting: ${AFFECTED[*]}"
    if ! dc_timeout start "${AFFECTED[@]}"; then
        error "Could not start ${AFFECTED[*]}; start them by hand"
        exit 1
    fi
fi

log "Restore complete: ${RESTORED[*]}"
log "The data from before the restore is kept as <dir>.pre-restore-$STAMP; delete it once the services work."
