#!/bin/bash
#
# NDJSON / MongoDB overlap check (issue #1622, phase 2)
#
# While both run, every reading goes to MongoDB and to the daily NDJSON files,
# so for each stream and UTC day the NDJSON lines must equal the Mongo
# documents whose _tz is in that day. This checks it and prints a markdown
# table for the issue.
#
# The writers, their stream and the host raw directory come from the compose
# config (compose resolves RAW_DATA_PATH=${DATA_PATH}/raw from .env); the Mongo
# documents from `docker compose exec mongo mongosh`, as backup_mongo does. The
# comparison is scripts/ndjson-overlap/index.mjs: run with the host's Node if
# there is one (18+), else in the node image, with the raw directory mounted
# read-only. Nothing is written except the --results file (or a temporary
# file in its place).
#
# Progress goes to stderr, the table to stdout. See ndjson-overlap/README.md.
#

set -euo pipefail

HELPER_SCRIPT="$(dirname "$0")/docker-helper.sh"
if [ ! -f "$HELPER_SCRIPT" ]; then
    echo "FATAL: Required helper library not found: $HELPER_SCRIPT" >&2
    exit 2
fi
# shellcheck source=scripts/docker-helper.sh
source "$HELPER_SCRIPT" || {
    echo "FATAL: Failed to load helper library: $HELPER_SCRIPT" >&2
    exit 2
}

# Exit status 1 means "differ": any other failure must exit 2, not set -e's 1
trap 'exit 2' ERR

TOOL_DIR="$SCRIPT_DIR/ndjson-overlap"
NODE_IMAGE="${NDJSON_OVERLAP_NODE_IMAGE:-ghcr.io/groupsky/homy/node:22.22.0-alpine3.23}"

usage() {
    cat <<EOF
Usage: $(basename "$0") [OPTIONS] [DAY...]

Compare each stream's NDJSON files with MongoDB for whole UTC days and print
a markdown table (stream | UTC day | Mongo | NDJSON | equal | notes).

  DAY               UTC day as YYYY-MM-DD (default: yesterday, UTC)

Options:
  -h, --help        Show this help message and exit
  --stream NAME     Check only this stream; repeat for more
                    (default: every stream that has an NDJSON writer)
  --results FILE    Append each result to FILE (JSON lines) and print the
                    table of everything in FILE, so you can collect all 7
                    days in one table. Keep it on the host: it holds sample
                    readings.
  --samples         Also print the records that differ. To read on the host
                    only: never paste them into the (public) issue.

Exit status: 0 all equal, 1 some stream and day differ, 2 the check failed.
EOF
}

STREAM_ARGS=()
DAYS=()
RESULTS=""
REPORT_ARGS=()
while [ $# -gt 0 ]; do
    case "$1" in
        -h|--help) usage; exit 0 ;;
        --stream)
            [ $# -ge 2 ] || { error "--stream needs a stream name"; exit 2; }
            STREAM_ARGS+=(--stream "$2"); shift 2 ;;
        --results)
            [ $# -ge 2 ] || { error "--results needs a file"; exit 2; }
            RESULTS="$2"; shift 2 ;;
        --samples) REPORT_ARGS+=(--samples); shift ;;
        -*) error "Unknown option: $1"; usage >&2; exit 2 ;;
        *) DAYS+=("$1"); shift ;;
    esac
done

if ! command -v jq &> /dev/null; then
    error "jq is required but not installed"
    exit 2
fi

# A relative --results is relative to where the script was started. Check it
# can be written now, not after the first slow Mongo query.
if [ -n "$RESULTS" ]; then
    RESULTS=$(realpath -m -- "$RESULTS")
    if ! : >> "$RESULTS"; then
        error "Cannot write the results file $RESULTS"
        exit 2
    fi
fi
cd "$PROJECT_DIR"

# Directories index.mjs reads, mounted read-only when it runs in the node image
NODE_MOUNTS=()

host_node_usable() {
    local major
    command -v node &> /dev/null || return 1
    major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null) || return 1
    [ "$major" -ge 18 ]
}

run_node() {
    if host_node_usable; then
        node "$TOOL_DIR/index.mjs" "$@"
        return
    fi
    local mounts=(-v "$TOOL_DIR:$TOOL_DIR:ro") dir
    for dir in "${NODE_MOUNTS[@]}"; do
        mounts+=(-v "$dir:$dir:ro")
    done
    docker run --rm -i --network none --user "$(id -u):$(id -g)" \
        "${mounts[@]}" "$NODE_IMAGE" node "$TOOL_DIR/index.mjs" "$@"
}

# Prints the output of a mongosh script run against the app database.
# stdin comes from /dev/null, so the exec cannot eat the caller's input.
# Usage: mongo_eval SCRIPT
mongo_eval() {
    # shellcheck disable=SC2016  # expanded inside the container
    dc_run exec -T mongo sh -c 'exec mongosh --quiet --norc --authenticationDatabase admin -u "$(cat /run/secrets/mongo_root_username)" -p "$(cat /run/secrets/mongo_root_password)" "$MONGO_INITDB_DATABASE" --eval "$1"' mongosh "$1" < /dev/null
}

if ! compose=$(dc_run config --format json); then
    error "Could not read the compose config"
    exit 2
fi
if ! plan=$(run_node plan "${STREAM_ARGS[@]}" "${DAYS[@]}" <<< "$compose"); then
    exit 2
fi

results_file="$RESULTS"
if [ -z "$results_file" ]; then
    results_file=$(mktemp)
    trap 'rm -f "$results_file"' EXIT
fi

while IFS= read -r job <&3; do
    [ -n "$job" ] || continue
    stream=$(jq -r .stream <<< "$job")
    day=$(jq -r .day <<< "$job")
    NODE_MOUNTS=("$(jq -r .rawDir <<< "$job")")
    echo "Checking $stream $day..." >&2
    if ! result=$(mongo_eval "$(jq -r .mongoScript <<< "$job")" | run_node compare "$job"); then
        error "Could not check $stream $day"
        exit 2
    fi
    printf '%s\n' "$result" >> "$results_file"
done 3<<< "$plan"

NODE_MOUNTS=()
rc=0
run_node report "${REPORT_ARGS[@]}" < "$results_file" || rc=$?
exit "$rc"
