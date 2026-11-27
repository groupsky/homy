#!/bin/bash
#
# Host subnet pre-flight (issue #1559)
#
# Do the subnets this repo pins collide with what THIS HOST already has? It
# reads the host's own .env (through `docker compose config`, which also fails
# on a required variable that is missing), lists every existing Docker network
# and every host route, and fails when a pinned subnet overlaps one of them.
# Nothing is changed or stopped.
#
# The CI guards read example.env, which no host has to match; this reads the
# host. Run it on the host before a network change; deploy.sh runs it after the
# code update and before the pull, the snapshot or any restart.
#
# The checks are scripts/check-subnets/lib.mjs, run with the host's Node (18+)
# or else in the node image.
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

# Exit status 1 means "conflict": any other failure must exit 2, not set -e's 1
trap 'exit 2' ERR

TOOL_DIR="$SCRIPT_DIR/check-subnets"
NODE_IMAGE="${CHECK_SUBNETS_NODE_IMAGE:-ghcr.io/groupsky/homy/node:22.22.0-alpine3.23}"

usage() {
    cat <<EOF2
Usage: $(basename "$0") [-h|--help]

Fail when a subnet pinned in the compose files (from this host's .env) overlaps
an existing Docker network, a host route, or another pinned subnet.
A network that already has the pinned name is the one being recreated and is
not counted against itself. Routes through Docker's own bridges are covered by
the network list.

Exit status: 0 no conflict, 1 conflict, 2 the check could not run.
EOF2
}

case "${1:-}" in
    "") ;;
    -h|--help) usage; exit 0 ;;
    *) error "Unknown option: $1"; usage >&2; exit 2 ;;
esac

# Not require_jq: it exits 1, which would read as "conflict"
if ! command -v jq &> /dev/null; then
    error "jq is required but not installed"
    exit 2
fi
cd "$PROJECT_DIR"

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT
trap 'exit 2' ERR

# 1. The compose config with the host's .env: stops here on a missing required variable
if ! dc_base config --format json > "$WORK_DIR/compose.json"; then
    error "docker compose config failed: a required variable is missing from .env, or the compose files are invalid"
    exit 2
fi

# 2. Every existing Docker network
: > "$WORK_DIR/networks.json"
# A plain assignment, so a daemon that cannot be reached fails here (compose
# config alone does not need it) instead of passing with an empty list
if ! network_ids=$(docker network ls -q); then
    error "Could not list the Docker networks (is the daemon running and reachable?)"
    exit 2
fi
mapfile -t NETWORK_IDS <<< "$network_ids"
if [ -n "$network_ids" ]; then
    docker network inspect "${NETWORK_IDS[@]}" > "$WORK_DIR/networks.json"
fi

# 3. Every host route
if command -v ip &> /dev/null; then
    ip -4 route show > "$WORK_DIR/routes.txt"
else
    warn "'ip' not found: host routes are not checked, only Docker networks"
    : > "$WORK_DIR/routes.txt"
fi

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
    # The tool and the shared lib/ sit under SCRIPT_DIR; the inputs under WORK_DIR
    docker run --rm -i --network none --user "$(id -u):$(id -g)" \
        -v "$SCRIPT_DIR:$SCRIPT_DIR:ro" -v "$WORK_DIR:$WORK_DIR:ro" \
        "$NODE_IMAGE" node "$TOOL_DIR/index.mjs" "$@"
}

# index.mjs exits 1 for a conflict, 2 for a failure: do not let `set -e` or the ERR trap turn 1 into 2
status=0
conflicts=$(run_node "$WORK_DIR/compose.json" "$WORK_DIR/networks.json" "$WORK_DIR/routes.txt" 2>&1) || status=$?
case "$status" in
    0) log "Subnet check passed: no pinned subnet overlaps a Docker network or a host route" ;;
    1)
        error "A pinned subnet overlaps something already on this host (nothing was changed):"
        echo "$conflicts" >&2
        error "Change the subnet in this host's .env, or remove the old network, before deploying. See docs/DEPLOYMENT.md, 'Network topology changes'."
        exit 1
        ;;
    *)
        error "The subnet check failed to run: $conflicts"
        exit 2
        ;;
esac
