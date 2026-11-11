#!/usr/bin/env bats
# Tests for scripts/ci/master-base-ref.sh against a real throwaway git repo.

load test_helper

SCRIPT="${BATS_TEST_DIRNAME}/../ci/master-base-ref.sh"

setup() {
    REPO="$(mktemp -d)"
    cd "$REPO"
    git init -q -b master
    git config user.email test@example.com
    git config user.name test
    commit() { echo "$1" > "$1"; git add "$1"; git commit -q -m "$1"; }
    commit base
    BEFORE="$(git rev-parse HEAD)"
}

teardown() {
    rm -rf "$REPO"
}

@test "two-commit push with the change in the first commit: base is before, not HEAD^1" {
    echo change > docker-file; git add docker-file; git commit -q -m first
    echo docs > readme; git add readme; git commit -q -m second

    run "$SCRIPT" "$BEFORE"
    assert_success
    assert_output "$BEFORE"

    # The change in the first commit is inside the compared range.
    run git diff --name-only "$output" HEAD
    assert_output --partial docker-file
}

@test "single-commit push: before equals HEAD^1" {
    echo change > f; git add f; git commit -q -m one
    run "$SCRIPT" "$BEFORE"
    assert_success
    assert_output "$(git rev-parse HEAD^1)"
}

@test "empty before (workflow_dispatch) falls back to HEAD^1" {
    echo change > f; git add f; git commit -q -m one
    run "$SCRIPT" ""
    assert_success
    assert_output "$(git rev-parse HEAD^1)"
}

@test "null SHA (branch creation) falls back to HEAD^1" {
    echo change > f; git add f; git commit -q -m one
    run "$SCRIPT" 0000000000000000000000000000000000000000
    assert_success
    assert_output "$(git rev-parse HEAD^1)"
}

@test "force-push: before is not an ancestor, falls back to HEAD^1" {
    echo a > f; git add f; git commit -q -m old-tip
    OLD="$(git rev-parse HEAD)"
    git reset -q --hard "$BEFORE"
    echo b > g; git add g; git commit -q -m new-tip

    run "$SCRIPT" "$OLD"
    assert_success
    assert_output "$(git rev-parse HEAD^1)"
}

@test "before not in the clone falls back to HEAD^1" {
    echo change > f; git add f; git commit -q -m one
    run "$SCRIPT" 1234567890abcdef1234567890abcdef12345678
    assert_success
    assert_output "$(git rev-parse HEAD^1)"
}
