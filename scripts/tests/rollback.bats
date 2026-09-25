#!/usr/bin/env bats
#
# rollback.sh restores the whole stack from a volman backup. It must be told
# which backup: the one .pre-upgrade-backup names can be weeks older than the
# version it goes back to, and ~100 GB of newer data would be thrown away.

load test_helper
load mock_stack

setup() {
    setup_test_env
    setup_mock_stack
    for f in docker-helper.sh rollback.sh restore.sh; do
        cp "${BATS_TEST_DIRNAME}/../$f" "$PROJECT_DIR/scripts/$f"
    done
    chmod +x "$PROJECT_DIR/scripts/"*.sh
    printf '#!/bin/bash\ncat > /dev/null\n' > "$MOCK_BIN/systemd-cat"
    chmod +x "$MOCK_BIN/systemd-cat"
    mock_container automations c-auto img-a running | mock_containers
    echo '{"services": {"automations": {"image": "a:1", "restart": "unless-stopped"}}}' > "$MOCK_DIR/config.json"
    echo "2024_01_27_120000" > "$BACKUP_REF_FILE"
    echo "1111111111111111111111111111111111111111" > "$PREVIOUS_VERSION_FILE"
    export QUIET=0
}

teardown() {
    teardown_test_env
}

@test "rollback.sh: refuses to run without an explicit backup name" {
    cd "$PROJECT_DIR"
    run scripts/rollback.sh -y
    assert_failure
    assert_output --partial "Name the backup to restore"
    run grep -E "compose (stop|run)" "$MOCK_DIR/calls.log"
    assert_failure
}

@test "rollback.sh: a failed restore starts the existing containers again, it does not recreate them" {
    cd "$PROJECT_DIR"
    touch "$MOCK_DIR/fail-run"

    run scripts/rollback.sh -y 2024_01_27_120000
    assert_failure
    assert_output --partial "Backup restoration failed"
    run grep -E "compose (start|up)" "$MOCK_DIR/calls.log"
    assert_output --partial "compose start"
    refute_output --partial "compose up"
}
