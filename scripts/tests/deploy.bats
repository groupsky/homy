#!/usr/bin/env bats
#
# Regression tests for the deploy code-update step.
#
# Issue #1406: on a host whose global git config sets submodule.recurse=true
# (routy does), `git pull origin master` in this repository dies with
# "fatal: bad object 0000000000000000000000000000000000000000" on a clean
# fast-forward that touches no submodule pointer. deploy.sh's default (no
# --tag) path runs exactly that pull, so every such deploy was blocked.
#
# The mock git below reproduces that host: every command submodule.recurse
# applies to - `fetch`, `checkout`, `pull` - fails with that error unless the
# caller passed `-c submodule.recurse=false`, the workaround verified on routy.
# Everything else about the mock is deliberately boring.

load test_helper

setup() {
    setup_test_env

    export GIT_CALLS="$TEST_DIR/git-calls.log"
    : > "$GIT_CALLS"

    # Mock git emulating a host with submodule.recurse=true
    cat > "$TEST_DIR/git" <<'EOF'
#!/bin/bash
echo "$*" >> "$GIT_CALLS"

recurse_disabled=0
while [ "${1:-}" = "-c" ]; do
    [ "$2" = "submodule.recurse=false" ] && recurse_disabled=1
    shift 2
done

# submodule.recurse applies to fetch, checkout and pull alike
case "${1:-}" in
    fetch|checkout|pull)
        if [ "$recurse_disabled" -eq 0 ] && [ "${MOCK_GIT_RECURSE_BREAKS:-1}" -eq 1 ]; then
            echo "fatal: bad object 0000000000000000000000000000000000000000" >&2
            exit 128
        fi
        ;;&
    pull)
        if [ "${MOCK_GIT_PULL_FAILS:-0}" -eq 1 ]; then
            echo "fatal: could not read from remote repository" >&2
            exit 128
        fi
        echo "Updating 1111111..2222222"
        echo "Fast-forward"
        ;;
    checkout)
        if [ "${MOCK_GIT_CHECKOUT_FAILS:-0}" -eq 1 ]; then
            echo "error: pathspec 'master' did not match any file(s) known to git" >&2
            exit 1
        fi
        echo "Already on 'master'"
        ;;
    fetch)
        echo "From origin"
        ;;
    config)
        echo "MOCK GIT: unexpected 'git config' - the fix must not write host config" >&2
        exit 1
        ;;
    submodule)
        if [ "${MOCK_GIT_SUBMODULE_FAILS:-0}" -eq 1 ]; then
            echo "fatal: bad object 0000000000000000000000000000000000000000" >&2
            exit 128
        fi
        echo "Submodule paths checked out"
        ;;
    rev-parse)
        echo "2222222222222222222222222222222222222222"
        ;;
esac
exit 0
EOF
    chmod +x "$TEST_DIR/git"

    # Mock docker: the deploy stops at the image pull, which is far enough to
    # have exercised the code-update step and short of backups and health waits.
    cat > "$TEST_DIR/docker" <<'EOF'
#!/bin/bash
if [ "$1" = "compose" ]; then
    shift
    case "$1" in
        version)
            echo "Docker Compose version v2.24.0"
            exit 0
            ;;
        pull)
            echo "Error response from daemon: manifest unknown" >&2
            exit 1
            ;;
    esac
fi
exit 0
EOF
    chmod +x "$TEST_DIR/docker"

    export PATH="$TEST_DIR:$PATH"

    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    cp "${BATS_TEST_DIRNAME}/../deploy.sh" "$PROJECT_DIR/scripts/deploy.sh"
    chmod +x "$PROJECT_DIR/scripts/docker-helper.sh" "$PROJECT_DIR/scripts/deploy.sh"
}

teardown() {
    teardown_test_env
}

# --- git_no_submodules ------------------------------------------------------

@test "git_no_submodules: disables submodule recursion for the invocation" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    run git_no_submodules pull origin master
    assert_success
    assert_output --partial "Fast-forward"
    assert_equal "$(cat "$GIT_CALLS")" "-c submodule.recurse=false pull origin master"
}

@test "git_no_submodules: writes nothing to the host's git config" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    run git_no_submodules pull origin master
    assert_success

    # -c applies to this invocation only. An implementation that instead set
    # submodule.recurse=false globally would pass the tests above; the mock
    # fails any `git config`, and the recorded calls must contain none.
    run cat "$GIT_CALLS"
    refute_line --partial "config "
    refute_line --partial "--global"
}

# --- update_code ------------------------------------------------------------

@test "update_code: pulls successfully on a host with submodule.recurse=true" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    run update_code
    assert_success
    refute_output --partial "bad object"
}

@test "update_code: checks out master before pulling" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    run update_code
    assert_success

    run cat "$GIT_CALLS"
    assert_line --index 0 "-c submodule.recurse=false checkout master"
    assert_line --index 1 "-c submodule.recurse=false pull origin master"
}

@test "update_code: updates submodules explicitly after the pull" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    run update_code
    assert_success

    run cat "$GIT_CALLS"
    assert_line --index 2 "submodule update --init --recursive"
}

@test "update_code: reports failure when the pull genuinely fails" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    MOCK_GIT_PULL_FAILS=1 run update_code
    assert_failure
}

@test "update_code: reports failure when the checkout fails" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    MOCK_GIT_CHECKOUT_FAILS=1 run update_code
    assert_failure

    run cat "$GIT_CALLS"
    refute_line --partial "pull"
}

@test "update_code: leaves the working tree at master when git recursion is broken" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    # Belt and braces: with the mock's recursion failure disabled the same run
    # must still pass, so the tests above are not passing by accident.
    MOCK_GIT_RECURSE_BREAKS=0 run update_code
    assert_success
}

# --- checkout_git_version (used by rollback.sh) ------------------------------

@test "checkout_git_version: checks out without recursing into submodules" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    run checkout_git_version "2222222222222222222222222222222222222222"
    assert_success

    run cat "$GIT_CALLS"
    assert_line --partial "-c submodule.recurse=false checkout"
    refute_output --partial "bad object"
}

# --- update_submodules ------------------------------------------------------

@test "update_submodules: succeeds when the submodule update succeeds" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    run update_submodules
    assert_success
}

@test "update_submodules: never fails the deploy when the update fails" {
    source_docker_helper "$PROJECT_DIR/scripts/docker-helper.sh"

    QUIET=0 MOCK_GIT_SUBMODULE_FAILS=1 run update_submodules
    assert_success
    assert_output --partial "WARNING: submodule update failed"
}

# --- deploy.sh end to end ---------------------------------------------------

@test "deploy.sh: gets past the code-update step on a host with submodule.recurse=true" {
    cd "$PROJECT_DIR"
    export QUIET=0

    # The image pull is mocked to fail, so the deploy stops there - after the
    # code update it must have completed, and well before backups or restarts.
    run scripts/deploy.sh --yes
    assert_failure
    assert_output --partial "Pulling latest code..."
    assert_output --partial "Failed to pull images from GHCR"
    refute_output --partial "bad object"

    run cat "$GIT_CALLS"
    assert_line "-c submodule.recurse=false pull origin master"
}

@test "deploy.sh: fetches without recursing into submodules" {
    cd "$PROJECT_DIR"
    export QUIET=0

    run scripts/deploy.sh --yes
    refute_output --partial "bad object"

    run cat "$GIT_CALLS"
    assert_line "-c submodule.recurse=false fetch origin master"
    refute_line "fetch origin master"
}

@test "deploy.sh: does not run a submodule-recursing pull" {
    cd "$PROJECT_DIR"
    export QUIET=0

    run scripts/deploy.sh --yes

    run cat "$GIT_CALLS"
    refute_line "pull origin master"
}

@test "deploy.sh: skips the code update when deploying a specific tag" {
    cd "$PROJECT_DIR"
    export QUIET=0

    run scripts/deploy.sh --yes --tag latest
    assert_failure
    refute_output --partial "Pulling latest code..."

    run cat "$GIT_CALLS"
    refute_line --partial "pull"
}
