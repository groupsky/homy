#!/bin/bash
#
# Pre-deploy snapshot
#
# Takes one ZFS snapshot of the dataset that holds all of the stack's state,
# with the stack running. It is crash-consistent (like a power cut) across
# InfluxDB, Mongo, the broker, HA, zigbee2mqtt and Grafana at one instant.
#
# Nothing here is host-specific: the dataset is found at run time from the
# writable host mounts in the compose config. The script refuses to snapshot
# when those are not all on one dataset, when a service keeps state in a
# Docker volume (the snapshot would not cover it), or when the pool is low on
# space.
#
# Prints only the snapshot name on stdout; progress goes to stderr and the log.
# The deploy user needs `zfs allow <user> snapshot <dataset>`; it cannot and
# does not destroy snapshots. The host prunes them by the homy-deploy- prefix.
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

# stdout carries only the snapshot name (fd 3); everything else goes to stderr
exec 3>&1 1>&2

# The host prunes by this prefix: keep it exact
SNAPSHOT_PREFIX="homy-deploy-"
MIN_FREE_GB="${SNAPSHOT_MIN_FREE_GB:-20}"
SHORT_SHA=""
CHECK_ONLY=0

usage() {
    cat <<EOF
Usage: $(basename "$0") --sha SHORT_SHA [OPTIONS]
       $(basename "$0") --check [OPTIONS]

Take the pre-deploy ZFS snapshot of the stack's data, named
  <dataset>@${SNAPSHOT_PREFIX}<UTC yyyymmddThhmmssZ>-<short sha>
and record it in .pre-deploy-snapshot.

Options:
  -h, --help            Show this help message and exit
  --sha SHORT_SHA       Short git SHA of the version being deployed
  --check               Check that a snapshot can be taken; take none
  --min-free-gb N       Refuse when the pool has less than N GiB free
                        (default: \$SNAPSHOT_MIN_FREE_GB or 20)

Exit status is non-zero when no snapshot was taken.
EOF
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            usage >&3
            exit 0
            ;;
        --sha)
            SHORT_SHA="${2:-}"
            shift 2
            ;;
        --check)
            CHECK_ONLY=1
            shift
            ;;
        --min-free-gb)
            MIN_FREE_GB="${2:-}"
            shift 2
            ;;
        *)
            error "Unknown option: $1"
            exit 1
            ;;
    esac
done

if ! [[ "$MIN_FREE_GB" =~ ^[0-9]+$ ]]; then
    error "--min-free-gb must be a whole number of GiB, got '$MIN_FREE_GB'"
    exit 1
fi
if [ "$CHECK_ONLY" -eq 0 ] && ! [[ "$SHORT_SHA" =~ ^[A-Za-z0-9._-]+$ ]]; then
    error "--sha is required and may hold only letters, digits, '.', '_' and '-'"
    exit 1
fi

cd "$PROJECT_DIR"
validate_compose_file
require_jq

if ! command -v zfs &> /dev/null; then
    error "The stack's data is not on ZFS here (no zfs command), so no snapshot can be taken"
    exit 1
fi

CONFIG=$(mktemp)
trap 'rm -f "$CONFIG"' EXIT
if ! dc_run config --format json > "$CONFIG"; then
    error "Could not read the compose config"
    exit 1
fi

# 1. No state in Docker volumes: the dataset snapshot would not contain it
problems=()
while IFS=$'\t' read -r svc vol; do
    [ -n "$svc" ] && problems+=("$svc: Docker volume $vol")
done < <(compose_state_volumes "$CONFIG")

running_ids=$(dc_run ps -q 2>/dev/null) || running_ids=""
if [ -n "$running_ids" ]; then
    # shellcheck disable=SC2086
    if ! running=$(docker inspect $running_ids | jq -r '.[]
            | select((.HostConfig.RestartPolicy.Name // "no") != "no")
            | (.Config.Labels["com.docker.compose.service"] // .Name) as $svc
            | (.Mounts // [])[] | select(.Type == "volume")
            | [$svc, (.Name // "?") + " at " + .Destination] | @tsv'); then
        error "Could not inspect the running containers"
        exit 1
    fi
    while IFS=$'\t' read -r svc vol; do
        [ -n "$svc" ] && problems+=("$svc: Docker volume $vol")
    done <<<"$running"
fi

if [ "${#problems[@]}" -gt 0 ]; then
    error "Some state is in Docker volumes, which the snapshot would not cover:"
    printf '  %s\n' "${problems[@]}" >&2
    exit 1
fi

# 2. Every persistent host mount on one dataset
datasets=()
mounts=()
while IFS=$'\t' read -r svc src; do
    [ -n "$svc" ] || continue
    # A directory docker has not created yet lives where its parent does
    probe="$src"
    while [ ! -e "$probe" ] && [ "$probe" != "/" ]; do
        probe=$(dirname "$probe")
    done
    if ! ds=$(zfs list -H -o name "$probe" 2>/dev/null) || [ -z "$ds" ]; then
        error "$svc keeps data in $src, which is not on ZFS"
        exit 1
    fi
    mounts+=("$svc $src -> $ds")
    datasets+=("$ds")
done < <(persistent_mounts "$CONFIG")

if [ "${#datasets[@]}" -eq 0 ]; then
    error "No service has a writable host mount; there is nothing to snapshot"
    exit 1
fi

unique=$(printf '%s\n' "${datasets[@]}" | LC_ALL=C sort -u)
if [ "$(wc -l <<<"$unique")" -ne 1 ]; then
    error "The stack's data is on more than one dataset; one snapshot cannot cover it:"
    printf '  %s\n' "${mounts[@]}" >&2
    exit 1
fi
DATASET="$unique"
log "All ${#mounts[@]} data mounts are on dataset $DATASET"

# 3. Enough free space in the pool
POOL="${DATASET%%/*}"
if ! avail=$(zfs list -H -p -o avail "$POOL" 2>/dev/null) || ! [[ "$avail" =~ ^[0-9]+$ ]]; then
    error "Could not read the free space of pool $POOL"
    exit 1
fi
min_bytes=$((MIN_FREE_GB * 1024 * 1024 * 1024))
if [ "$avail" -lt "$min_bytes" ]; then
    error "Pool $POOL has $((avail / 1024 / 1024 / 1024)) GiB free, less than the ${MIN_FREE_GB} GiB limit; not taking a snapshot"
    exit 1
fi
log "Pool $POOL has $((avail / 1024 / 1024 / 1024)) GiB free (limit ${MIN_FREE_GB} GiB)"

if [ "$CHECK_ONLY" -eq 1 ]; then
    log "Check passed: a snapshot of $DATASET can be taken"
    exit 0
fi

# 4. Take it, check it is there, record it for the rollback and the restore
NAME="${DATASET}@${SNAPSHOT_PREFIX}$(date -u +%Y%m%dT%H%M%SZ)-${SHORT_SHA}"
log "Taking snapshot $NAME"
if ! zfs snapshot "$NAME"; then
    error "zfs snapshot $NAME failed"
    exit 1
fi

if [ "$(zfs list -H -t snapshot -o name "$NAME" 2>/dev/null)" != "$NAME" ]; then
    error "Snapshot $NAME was not found after taking it"
    exit 1
fi

if ! atomic_write "$SNAPSHOT_REF_FILE" "$NAME"; then
    error "Snapshot $NAME exists, but could not be recorded in $SNAPSHOT_REF_FILE"
    exit 1
fi

log "Snapshot $NAME taken"
echo "$NAME" >&3
