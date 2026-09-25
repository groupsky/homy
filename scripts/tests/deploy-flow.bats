#!/usr/bin/env bats
#
# deploy.sh end to end against a fake docker, zfs and git (#1607):
#   - the snapshot comes first, and a failed snapshot stops the deploy before
#     the code, the images or any container is touched (unless --skip-snapshot);
#   - nothing is stopped: no backup.sh, no down, no stop;
#   - `up` runs with the digest override, --no-build and --pull never, and the
#     health gate waits on what actually changed;
#   - a failed gate rolls code and images back and never restores data, except
#     that a stateful service whose image changed is left for a manual restore.

load test_helper
load mock_stack

bats_require_minimum_version 1.5.0

OLD=1111111111111111111111111111111111111111
NEW=2222222222222222222222222222222222222222

setup() {
    setup_test_env
    setup_mock_stack
    install_mock_zfs

    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    cp "${BATS_TEST_DIRNAME}/../deploy.sh" "$PROJECT_DIR/scripts/deploy.sh"
    cp "${BATS_TEST_DIRNAME}/../snapshot.sh" "$PROJECT_DIR/scripts/snapshot.sh"
    chmod +x "$PROJECT_DIR/scripts/"*.sh

    # git: origin/master is NEW; HEAD is OLD until a pull or checkout moves
    # it (kept in $MOCK_DIR/head); every call is recorded
    export GIT_CALLS="$MOCK_DIR/git.log"
    echo "$OLD" > "$MOCK_DIR/head"
    cat > "$MOCK_BIN/git" <<EOF
#!/bin/bash
echo "\$*" >> "\$GIT_CALLS"
case "\$*" in
    *"pull origin master"*) echo "$NEW" > "\$MOCK_DIR/head" ;;
    *"checkout master"*) ;;
    *checkout\ *) echo "\${@: -1}" > "\$MOCK_DIR/head" ;;
    *"rev-parse origin/master"*) echo "$NEW" ;;
    *"rev-parse HEAD"*) cat "\$MOCK_DIR/head" ;;
    *"rev-parse --verify"*)
        # only OLD and NEW are commits this repository knows
        case "\$*" in *$OLD*|*$NEW*) echo "$NEW" ;; *) exit 1 ;; esac ;;
    *rev-parse*) echo "$NEW" ;;
esac
exit 0
EOF
    # notifications: recorded, never sent; nothing reaches the real journal
    cat > "$MOCK_BIN/curl" <<'EOF'
#!/bin/bash
for a in "$@"; do case "$a" in text=*) echo "${a#text=}" >> "$MOCK_DIR/notify.log" ;; esac; done
echo '{"ok":true,"result":{"message_id":1}}'
EOF
    printf '#!/bin/bash\ncat > /dev/null\n' > "$MOCK_BIN/systemd-cat"
    chmod +x "$MOCK_BIN/git" "$MOCK_BIN/curl" "$MOCK_BIN/systemd-cat"
    echo "token" > "$PROJECT_DIR/secrets/telegram_bot_token"
    echo "chat" > "$PROJECT_DIR/secrets/telegram_chat_id"
    : > "$MOCK_DIR/notify.log"

    DATA="$TEST_DIR/tank/homy"
    mkdir -p "$DATA/home-assistant"
    printf '%s\t%s\n' "$DATA" "tank/homy" > "$MOCK_DIR/zfs/datasets"

    jq -n --arg d "$DATA" '{services: {
        automations: {image: "ghcr.io/groupsky/homy/automations:tag", restart: "unless-stopped"},
        ha: {image: "ghcr.io/groupsky/homy/homeassistant:tag", restart: "unless-stopped",
             labels: {"homy.stateful": "true"},
             volumes: [{type: "bind", source: ($d + "/home-assistant"), target: "/config"}]},
        volman: {image: "ghcr.io/groupsky/homy/volman:tag", restart: "no"}
    }}' > "$MOCK_DIR/config.json"
    cat > "$MOCK_DIR/images.json" <<'EOF'
[
  {"RepoTags": ["ghcr.io/groupsky/homy/automations:tag"], "RepoDigests": ["ghcr.io/groupsky/homy/automations@sha256:aaaa"]},
  {"RepoTags": ["ghcr.io/groupsky/homy/homeassistant:tag"], "RepoDigests": ["ghcr.io/groupsky/homy/homeassistant@sha256:hhhh"]},
  {"RepoTags": ["ghcr.io/groupsky/homy/volman:tag"], "RepoDigests": ["ghcr.io/groupsky/homy/volman@sha256:vvvv"]}
]
EOF
    {
        mock_container automations c-auto-1 img-a1 running
        mock_container ha c-ha-1 img-h1 running healthy
        mock_container volman c-volman img-v1 exited "" no
    } | mock_containers
    printf 'automations hash-automations\nha hash-ha\n' > "$MOCK_DIR/hashes"

    echo "$OLD" > "$VERSION_FILE"
    export QUIET=0 YES_FLAG=0
    export HEALTH_STABLE_SECONDS=0 HEALTH_POLL_INTERVAL=0 HEALTH_GATE_MARGIN=0
}

teardown() {
    teardown_test_env
}

deploy() {
    cd "$PROJECT_DIR"
    scripts/deploy.sh --yes "$@"
}

# Compose's config hash for the service now differs from its container's
# label, so the deploy predicts it and passes it to up
mark_changed() {
    sed -i "s/^$1 hash-$1\$/$1 hash-$1-NEW/" "$MOCK_DIR/hashes"
}

# up N replaces a service's container: new id, image and start time
recreate_on_up() {
    local n="$1" svc="$2" image="$3" status="${4:-running}" health="${5:-}"
    mark_changed "$svc"
    cat >> "$MOCK_DIR/up.$n.jq" <<EOF
map(if .Config.Labels["com.docker.compose.service"] == "$svc"
    then .Id = (.Id + "-up$n") | .Image = "$image" | .State.StartedAt = "2026-09-25T1$n:00:00Z"
       | .State.Status = "$status" | .State.Running = ("$status" == "running")
       | (if "$health" == "" then . else .State.Health.Status = "$health" end)
    else . end)
EOF
}

calls() { cat "$MOCK_DIR/calls.log"; }
up_count() { cat "$MOCK_DIR/up-count" 2>/dev/null || echo 0; }

# --- snapshot first -----------------------------------------------------------

@test "deploy.sh: a failed snapshot stops before pulling, updating code or recreating anything" {
    touch "$MOCK_DIR/zfs/fail-snapshot"

    run deploy
    assert_failure
    assert_output --partial "Snapshot failed; nothing was changed"

    run calls
    refute_output --partial "compose pull"
    refute_output --partial "compose up"
    refute_output --partial "compose stop"
    run cat "$GIT_CALLS"
    refute_output --partial "checkout"
    refute_output --partial "pull origin"
    assert_equal "$(cat "$VERSION_FILE")" "$OLD"
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "the pre-deploy snapshot failed. Nothing was changed."
}

@test "deploy.sh: data that is not on ZFS stops the deploy before anything is touched" {
    : > "$MOCK_DIR/zfs/datasets"

    run deploy
    assert_failure
    assert_output --partial "not on ZFS"
    run calls
    refute_output --partial "compose pull"
    refute_output --partial "compose up"
}

@test "deploy.sh: --skip-snapshot deploys without a snapshot" {
    : > "$MOCK_DIR/zfs/datasets"
    mark_changed automations

    run deploy --skip-snapshot
    assert_success
    assert_output --partial "Skipping the snapshot"
    run grep -sc "^zfs snapshot" "$MOCK_DIR/zfs/calls.log"
    assert_output --regexp "^0?$"
    run calls
    assert_output --partial "compose up"
}

@test "deploy.sh: the snapshot name is in the deploy log and taken before the pull" {
    recreate_on_up 1 automations img-a2

    run deploy
    assert_success
    log=$(ls "$PROJECT_DIR"/logs/deploy-*.log)
    run grep -E "Snapshot: tank/homy@homy-deploy-[0-9]{8}T[0-9]{6}Z-2222222$" "$log"
    assert_success
    # the short SHA is the version being deployed
    [[ "$(cat "$MOCK_DIR/zfs/snapshots")" == *-2222222 ]]
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "snapshot: tank/homy@homy-deploy-"
}

# --- no stop, only what changed ---------------------------------------------------

@test "deploy.sh: never stops the stack, runs no backup and no down" {
    recreate_on_up 1 automations img-a2

    run deploy
    assert_success
    run calls
    refute_output --partial "compose stop"
    refute_output --partial "compose down"
    refute_output --partial "compose run"
}

@test "deploy.sh: --skip-backup is only the old name of --skip-snapshot and runs no down" {
    run deploy --skip-backup
    assert_success
    run calls
    refute_output --partial "compose down"
    refute_output --partial "compose stop"
    run grep -sc "^zfs snapshot" "$MOCK_DIR/zfs/calls.log"
    assert_output --regexp "^0?$"
}

@test "deploy.sh: up gets only the changed services, with the digest override, --no-deps, --no-build and --pull never" {
    mark_changed automations

    run deploy
    assert_success

    run grep "compose up" "$MOCK_DIR/calls.log"
    assert_output --partial "COMPOSE_FILE=$PROJECT_DIR/docker-compose.yml:$PROJECT_DIR/docker-compose.deploy.yml"
    # --no-deps: compose 2.18 would otherwise also recreate every dependent
    assert_output --regexp "compose up -d --no-build --pull never --no-deps automations$"
    refute_output --partial "volman"

    assert_equal "$(jq -r '.services.automations.image' "$PROJECT_DIR/docker-compose.deploy.yml")" "ghcr.io/groupsky/homy/automations@sha256:aaaa"
}

@test "deploy.sh: pulls with the committed compose files and the new tag" {
    run deploy
    assert_success
    run grep "compose pull" "$MOCK_DIR/calls.log"
    assert_output "COMPOSE_FILE=$PROJECT_DIR/docker-compose.yml IMAGE_TAG=$NEW docker compose pull"
}

@test "deploy.sh: logs the predicted recreations before up" {
    printf 'automations hash-automations-NEW\nha hash-ha\n' > "$MOCK_DIR/hashes"
    recreate_on_up 1 automations img-a2

    run deploy
    assert_success
    assert_output --partial "Services to recreate: automations"
}

@test "deploy.sh: one changed stateless service is the only one recreated and gated" {
    recreate_on_up 1 automations img-a2

    run deploy
    assert_success
    assert_output --partial "Recreated or started: automations"
    assert_output --partial "Health gate: waiting up to 0s for: automations"
    refute_output --partial "ha: healthy"
    assert_output --partial "Deployment successful!"
    assert_equal "$(cat "$VERSION_FILE")" "$NEW"
    assert_equal "$(cat "$PREVIOUS_VERSION_FILE")" "$OLD"
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "Deployment successful: 22222222 (recreated: automations;"
}

@test "deploy.sh: a deploy that changes nothing restarts nothing" {
    run deploy
    assert_success
    assert_output --partial "Recreated or started: none"
    assert_output --partial "no service was recreated, nothing to check"
    assert_equal "$(cat "$VERSION_FILE")" "$NEW"
}

@test "deploy.sh: refuses to run on docker-compose v1, before touching anything" {
    export MOCK_COMPOSE_VERSION="docker-compose version 1.27.4, build 40524192"

    run deploy
    assert_failure
    assert_output --partial "docker compose v2 or newer is required"
    run cat "$GIT_CALLS"
    refute_output --partial "fetch"
    [ ! -s "$MOCK_DIR/zfs/snapshots" ]
}

# --- the gate and the rollback --------------------------------------------------

@test "deploy.sh: a failed gate on a stateless service rolls code and images back, restoring no data" {
    recreate_on_up 1 automations img-a2 exited
    recreate_on_up 2 automations img-a1 running

    run deploy
    assert_failure
    assert_output --partial "Deployment failed: unhealthy: automations"
    assert_output --partial "Rolling back code, config and images to $OLD (no data is restored)"
    assert_output --partial "Rollback to $OLD complete"

    # code back to the last good commit, previous images pulled and pinned, up again
    run cat "$GIT_CALLS"
    assert_line "-c submodule.recurse=false checkout $OLD"
    assert_equal "$(cat "$MOCK_DIR/head")" "$OLD"
    run grep "compose pull" "$MOCK_DIR/calls.log"
    assert_line --index 1 --partial "IMAGE_TAG=$OLD docker compose pull"
    assert_equal "$(up_count)" "2"

    # no data restore of any kind
    run calls
    refute_output --partial "compose run"
    refute_output --partial "compose stop"
    run cat "$MOCK_DIR/zfs/calls.log"
    refute_output --partial "rollback"

    assert_equal "$(cat "$VERSION_FILE")" "$OLD"
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "failed (unhealthy: automations"
    assert_output --partial "Rolled back to 11111111 after the failed deployment of 22222222. No data was restored."
}

@test "deploy.sh: a failed up is a failed deploy and is rolled back" {
    mark_changed automations
    touch "$MOCK_DIR/up.1.fail"

    run deploy
    assert_failure
    assert_output --partial "docker compose up failed"
    assert_output --partial "Rolling back code, config and images"
    assert_equal "$(up_count)" "2"
}

@test "deploy.sh: a stateful service with a new image is not rolled back; it is left for the manual restore" {
    recreate_on_up 1 ha img-h2 running unhealthy

    run deploy
    assert_failure
    assert_output --partial "Not rolling back: the image of stateful service(s) ha changed"
    assert_output --regexp "sudo scripts/restore-snapshot.sh --no-start --snapshot tank/homy@homy-deploy-[0-9]{8}T[0-9]{6}Z-2222222 ha"
    assert_equal "$(up_count)" "1"
    run grep -c "compose pull" "$MOCK_DIR/calls.log"
    assert_output "1"
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "CRITICAL: Deployment of 22222222 failed"
    assert_output --partial "NOT rolled back"
    assert_equal "$(cat "$VERSION_FILE")" "$OLD"
}

@test "deploy.sh: a stateful service recreated for a config change only is rolled back with the rest" {
    recreate_on_up 1 ha img-h1 running unhealthy
    recreate_on_up 2 ha img-h1 running healthy

    run deploy
    assert_failure
    refute_output --partial "Not rolling back"
    assert_output --partial "Rollback to $OLD complete"
    assert_equal "$(up_count)" "2"
}

@test "deploy.sh: a gate that cannot check fails the deploy loudly, without success and without rollback" {
    recreate_on_up 1 automations img-a2
    # after up, docker inspect answers once (the state after up), then fails
    echo 'echo 1 > "$MOCK_DIR/inspect-budget"' > "$MOCK_DIR/up.1.sh"

    run deploy
    assert_failure
    assert_output --partial "Health gate cannot check"
    assert_output --partial "health gate could not check the services"
    refute_output --partial "Deployment successful"
    assert_equal "$(up_count)" "1"
    assert_equal "$(cat "$VERSION_FILE")" "$OLD"
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "the health gate could NOT check the services"
}

@test "deploy.sh: container state unreadable after up is a gate that cannot check, not success" {
    recreate_on_up 1 automations img-a2
    echo 'touch "$MOCK_DIR/fail-inspect"' > "$MOCK_DIR/up.1.sh"

    run deploy
    assert_failure
    assert_output --partial "health gate could not check the services"
    refute_output --partial "Deployment successful"
    assert_equal "$(cat "$VERSION_FILE")" "$OLD"
}

@test "deploy.sh: a rollback that fails its own gate is reported as critical" {
    recreate_on_up 1 automations img-a2 exited
    recreate_on_up 2 automations img-a1 exited

    run deploy
    assert_failure
    assert_output --partial "Rollback failed"
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "CRITICAL: Rollback of 22222222 to 11111111 failed"
}

@test "deploy.sh: without a recorded previous version nothing is rolled back" {
    rm -f "$VERSION_FILE"
    recreate_on_up 1 automations img-a2 exited

    run deploy
    assert_failure
    assert_output --partial "The previous version (unknown in $VERSION_FILE) is not a known commit SHA"
    assert_equal "$(up_count)" "1"
}

@test "deploy.sh: a pull failure puts the code back and restarts nothing" {
    touch "$MOCK_DIR/fail-pull"

    run deploy
    assert_failure
    assert_output --partial "Failed to pull images from GHCR"
    assert_equal "$(up_count)" "0"
    run cat "$GIT_CALLS"
    assert_line "-c submodule.recurse=false checkout $OLD"
    assert_equal "$(cat "$MOCK_DIR/head")" "$OLD"
}

# --- a failed deploy that was not rolled back blocks the next one --------------

@test "deploy.sh: a stateful block records how to recover and blocks the next deploy" {
    recreate_on_up 1 ha img-h2 running unhealthy

    run deploy
    assert_failure
    assert_output --partial "restore-snapshot.sh --no-start --snapshot tank/homy@homy-deploy-"
    assert_output --partial "scripts/deploy.sh --tag $OLD --force"
    [ -f "$PROJECT_DIR/.deploy-blocked" ]
    run cat "$PROJECT_DIR/.deploy-blocked"
    assert_output --partial "stateful service(s) ha got a new image"

    # the next deploy (nothing would change now) must not report success
    : > "$MOCK_DIR/notify.log"
    run deploy --force
    assert_failure
    assert_output --partial "Deploying is blocked"
    refute_output --partial "Deployment successful"
    assert_equal "$(up_count)" "1"
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "Deployment refused"
}

@test "deploy.sh: a gate that could not check blocks the next deploy" {
    recreate_on_up 1 automations img-a2
    echo 'echo 1 > "$MOCK_DIR/inspect-budget"' > "$MOCK_DIR/up.1.sh"

    run deploy
    assert_failure
    [ -f "$PROJECT_DIR/.deploy-blocked" ]
}

@test "deploy.sh: a successful rollback does not block the next deploy" {
    recreate_on_up 1 automations img-a2 exited
    recreate_on_up 2 automations img-a1 running

    run deploy
    assert_failure
    [ ! -e "$PROJECT_DIR/.deploy-blocked" ]
}

@test "deploy.sh: a previous version that is not a commit SHA is not rolled back to" {
    echo "latest" > "$VERSION_FILE"
    recreate_on_up 1 automations img-a2 exited

    run deploy
    assert_failure
    assert_output --partial "is not a known commit SHA"
    assert_equal "$(up_count)" "1"
    [ -f "$PROJECT_DIR/.deploy-blocked" ]
}

@test "deploy.sh: a failed up with unreadable containers never rolls a stateful image back" {
    mark_changed automations
    touch "$MOCK_DIR/up.1.fail"
    echo 'touch "$MOCK_DIR/fail-inspect"' > "$MOCK_DIR/up.1.sh"

    run deploy
    assert_failure
    # nothing is known about what up changed: ha (stateful) may have a new image
    assert_output --partial "Not rolling back: the image of stateful service(s) ha changed"
    assert_equal "$(up_count)" "1"
}

@test "deploy.sh: a previous SHA that is not a known commit is not rolled back to" {
    echo "3333333333333333333333333333333333333333" > "$VERSION_FILE"
    recreate_on_up 1 automations img-a2 exited

    run deploy
    assert_failure
    assert_output --partial "is not a known commit SHA"
    assert_equal "$(up_count)" "1"
    [ -f "$PROJECT_DIR/.deploy-blocked" ]
}

# --- review round 2 ------------------------------------------------------------

@test "deploy.sh: nothing changed means no up at all" {
    run deploy
    assert_success
    assert_output --partial "Nothing to recreate or start"
    run grep -c "compose up" "$MOCK_DIR/calls.log"
    assert_output "0"
}

@test "deploy.sh: a stopped service is started too" {
    jq 'map(if .Id == "c-auto-1" then .State.Status = "exited" | .State.Running = false else . end)' \
        "$MOCK_DIR/containers.json" > "$MOCK_DIR/c2" && mv "$MOCK_DIR/c2" "$MOCK_DIR/containers.json"
    echo 'map(if .Id == "c-auto-1" then .State.Status = "running" | .State.Running = true | .State.StartedAt = "2026-09-25T12:00:00Z" else . end)' > "$MOCK_DIR/up.1.jq"

    run deploy
    assert_success
    run grep "compose up" "$MOCK_DIR/calls.log"
    assert_output --regexp "--no-deps automations$"
}

@test "deploy.sh: when the prediction fails, every long-running service goes to up" {
    touch "$MOCK_DIR/fail-config-hash"

    run deploy
    assert_output --partial "passing all of them to up"
    run grep "compose up" "$MOCK_DIR/calls.log"
    assert_output --regexp "--no-deps automations ha$"
}

@test "deploy.sh: a service with two containers is refused before up" {
    mock_container automations c-auto-old img-a0 exited | jq -s '.' > "$MOCK_DIR/extra.json"
    jq -s 'add' "$MOCK_DIR/containers.json" "$MOCK_DIR/extra.json" > "$MOCK_DIR/c2" && mv "$MOCK_DIR/c2" "$MOCK_DIR/containers.json"
    mark_changed automations

    run deploy
    assert_failure
    assert_output --partial "more than one container: automations"
    assert_equal "$(up_count)" "0"
    # the pins of the running version are not replaced by the refused one
    [ ! -e "$PROJECT_DIR/docker-compose.deploy.yml" ]
}

@test "deploy.sh: an up that hangs is stopped by the timeout and counts as failed" {
    mark_changed automations
    echo 'sleep 30 > /dev/null 2>&1' > "$MOCK_DIR/up.1.sh"
    export COMPOSE_TIMEOUT=1

    run deploy
    assert_failure
    assert_output --partial "docker compose up did not finish within 1s"
    assert_output --partial "Rolling back"
}

@test "deploy.sh: a failed service the rollback does not recreate fails the rollback (host-side cause)" {
    # automations breaks, and the old version recreates nothing: it is still
    # the broken container
    recreate_on_up 1 automations img-a2 exited

    run deploy
    assert_failure
    assert_output --partial "the rollback did not recreate automations"
    refute_output --partial "Rollback to $OLD complete"
    [ -f "$PROJECT_DIR/.deploy-blocked" ]
    run cat "$MOCK_DIR/notify.log"
    assert_output --partial "CRITICAL: Rollback of 22222222"
}

@test "deploy.sh: a failed forced redeploy of the running version blocks instead of rolling back" {
    echo "$NEW" > "$VERSION_FILE"
    recreate_on_up 1 automations img-a2 exited

    run deploy --force
    assert_failure
    assert_output --partial "nothing to roll back to"
    assert_equal "$(up_count)" "1"
    [ -f "$PROJECT_DIR/.deploy-blocked" ]
}

@test "deploy.sh: after a failed up, services compose never reached do not fail the rollback" {
    # up is given automations and ha, recreates automations, then fails
    mark_changed ha
    recreate_on_up 1 automations img-a2 exited
    touch "$MOCK_DIR/up.1.fail"
    recreate_on_up 2 automations img-a1 running

    run deploy
    assert_failure
    refute_output --partial "the rollback did not recreate"
    assert_output --partial "Rollback to $OLD complete"
    [ ! -e "$PROJECT_DIR/.deploy-blocked" ]
}
