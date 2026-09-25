#!/bin/bash
#
# The deploy's "recreate only what changed" against a REAL docker compose, at
# the version routy runs (2.18.1). The bats tests fake `up`, so they cannot
# see what compose itself recreates; this runs the same helper deploy.sh uses
# (generate_deploy_override + deploy_up) on a throwaway two-service project:
#
#   1. a first up creates everything;
#   2. nothing changed: nothing is recreated (and compose's config --hash
#      agrees with the label on the containers);
#   3. the same image under a new tag (CI's SHA retag): nothing is recreated;
#   4. a read-only mounted config file of `broker` changes: only `broker` is
#      recreated, not `client`, which depends on it. Compose 2.18 recreates the
#      dependents of a recreated service when they are passed to `up` (even
#      with --no-deps), so deploy_up passes only the predicted services.
#
# Needs docker and network access (compose binary from GitHub, image from GHCR).
# Usage: scripts/tests/compose-real.sh
#

set -euo pipefail

COMPOSE_VERSION="2.18.1"
COMPOSE_SHA256="b4e6aff14c30f82ce26e94d37686b5598b3f870ce1e053927c853b4f4b128575"
IMAGE_REPO="ghcr.io/groupsky/homy/node"
IMAGE_TAG_A="22.22.0-alpine3.23"
IMAGE_TAG_B="compose-real-retag"

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORK=$(mktemp -d)
PROJECT="homy-compose-real-$$"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "ok: $*"; }

# A compose plugin of the pinned version, private to this run
export DOCKER_CONFIG="$WORK/docker-config"
mkdir -p "$DOCKER_CONFIG/cli-plugins"
if [ -n "${HOME:-}" ] && [ -f "$HOME/.docker/config.json" ]; then
    # keep the caller's context and registry settings
    cp "$HOME/.docker/config.json" "$DOCKER_CONFIG/config.json"
fi
if [ -d "${HOME:-/nonexistent}/.docker/contexts" ]; then
    cp -r "$HOME/.docker/contexts" "$DOCKER_CONFIG/contexts"
fi
curl -fsSL -o "$DOCKER_CONFIG/cli-plugins/docker-compose" \
    "https://github.com/docker/compose/releases/download/v${COMPOSE_VERSION}/docker-compose-linux-x86_64"
echo "$COMPOSE_SHA256  $DOCKER_CONFIG/cli-plugins/docker-compose" | sha256sum -c - > /dev/null \
    || fail "checksum of docker compose ${COMPOSE_VERSION} does not match"
chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"

cleanup() {
    (cd "$WORK/project" 2>/dev/null && docker compose -p "$PROJECT" down --remove-orphans -t 1 > /dev/null 2>&1) || true
    docker image rm "$IMAGE_REPO:$IMAGE_TAG_B" > /dev/null 2>&1 || true
    rm -rf "$WORK"
}
trap cleanup EXIT

[ "$(docker compose version --short)" = "$COMPOSE_VERSION" ] || fail "docker compose is not $COMPOSE_VERSION"
pass "docker compose $COMPOSE_VERSION"

docker pull -q "$IMAGE_REPO:$IMAGE_TAG_A" > /dev/null
docker tag "$IMAGE_REPO:$IMAGE_TAG_A" "$IMAGE_REPO:$IMAGE_TAG_B"

mkdir -p "$WORK/project"
cd "$WORK/project"
echo "listener 1883" > broker.conf
echo "server broker" > client.conf
cat > docker-compose.yml <<EOF
name: $PROJECT
services:
  broker:
    image: $IMAGE_REPO:\${IMAGE_TAG:-$IMAGE_TAG_A}
    command: ["sleep", "infinity"]
    init: true
    restart: unless-stopped
    volumes:
      - ./broker.conf:/etc/broker.conf:ro
  client:
    image: $IMAGE_REPO:\${IMAGE_TAG:-$IMAGE_TAG_A}
    command: ["sleep", "infinity"]
    init: true
    restart: unless-stopped
    depends_on:
      - broker
    volumes:
      - ./client.conf:/etc/client.conf:ro
EOF

export PROJECT_DIR="$WORK/project" SCRIPT_DIR="$REPO_DIR/scripts"
export LOCK_FILE="$WORK/lock" LOG_FILE="$WORK/log"
export DOCKER_COMPOSE_CMD="docker compose"
# shellcheck source=scripts/docker-helper.sh
source "$REPO_DIR/scripts/docker-helper.sh"

# What deploy.sh does between the pull and the gate
deploy() {
    dc_base config --format json > "$WORK/config.json"
    generate_deploy_override "$WORK/config.json" "$DEPLOY_OVERRIDE_FILE"
    mapfile -t services < <(long_running_services "$WORK/config.json")
    deploy_up "${services[@]}" > "$WORK/deploy.out" 2>&1 || { cat "$WORK/deploy.out"; fail "deploy_up failed"; }
}

started() {
    docker inspect -f '{{.State.StartedAt}}' "$(docker compose -p "$PROJECT" ps -q "$1")"
}

deploy
[ -n "$(started broker)" ] && [ -n "$(started client)" ] || fail "first up did not create both services"
pass "first up created broker and client"
b0=$(started broker); c0=$(started client)
sleep 1

deploy
grep -q "Nothing to recreate or start" "$WORK/deploy.out" || { cat "$WORK/deploy.out"; fail "an unchanged deploy predicted recreations: config --hash and the container label disagree"; }
[ "$(started broker)" = "$b0" ] && [ "$(started client)" = "$c0" ] || fail "an unchanged deploy restarted something"
pass "nothing changed: nothing restarted"

IMAGE_TAG="$IMAGE_TAG_B" deploy
[ "$(started broker)" = "$b0" ] && [ "$(started client)" = "$c0" ] || fail "the same image under a new tag restarted something"
pass "same image, new tag: nothing restarted"

echo "listener 1884" > broker.conf
deploy
[ "$(started broker)" != "$b0" ] || { cat "$WORK/deploy.out"; fail "broker was not recreated after its config file changed"; }
[ "$(started client)" = "$c0" ] || { cat "$WORK/deploy.out"; fail "client (depends on broker) was recreated too"; }
pass "broker config changed: only broker recreated, not its dependent"

# Control: what the old deploy did (every service passed to up). On 2.18.1 it
# also recreates the dependent; that is why deploy_up passes only the
# predicted services. Reported, not required.
c1=$(started client)
echo "listener 1885" > broker.conf
dc_base config --format json > "$WORK/config.json"
generate_deploy_override "$WORK/config.json" "$DEPLOY_OVERRIDE_FILE"
dc_deploy up -d --no-build --pull never --no-deps broker client > "$WORK/control.out" 2>&1 || { cat "$WORK/control.out"; fail "control up failed"; }
if [ "$(started client)" != "$c1" ]; then
    echo "note: passing every service to up recreates the dependent too, even with --no-deps (why only the predicted services are passed)"
else
    echo "note: this compose did not recreate the dependent even with every service passed"
fi

echo "all checks passed"
