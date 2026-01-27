#!/usr/bin/env bats

load test_helper

setup() {
    setup_test_env
    mock_docker_compose

    # Copy scripts to test directory
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    cp "${BATS_TEST_DIRNAME}/../restore.sh" "$PROJECT_DIR/scripts/restore.sh"

    # Make scripts executable
    chmod +x "$PROJECT_DIR/scripts/restore.sh"
    chmod +x "$PROJECT_DIR/scripts/docker-helper.sh"

    # Mock volman container and service status
    cat > "$TEST_DIR/docker" <<'EOF'
#!/bin/bash
if [ "$1" = "compose" ]; then
    shift
    if [ "$1" = "run" ] && [ "$3" = "volman" ]; then
        if [ "$4" = "restore" ]; then
            echo "Restoring from backup: $5"
            echo "Restore completed successfully"
            exit 0
        elif [ "$4" = "list" ]; then
            echo "Available backups:"
            echo "  2024_01_27_120000"
            echo "  2024_01_26_180000"
            exit 0
        fi
    elif [ "$1" = "ps" ]; then
        # No services running (required for restore)
        echo "NAME    STATE"
        exit 0
    elif [ "$1" = "up" ]; then
        exit 0
    fi
fi
exit 0
EOF
    chmod +x "$TEST_DIR/docker"
    export PATH="$TEST_DIR:$PATH"

    # Create jq mock (required for restore)
    cat > "$TEST_DIR/jq" <<'EOF'
#!/bin/bash
echo "0"
exit 0
EOF
    chmod +x "$TEST_DIR/jq"
}

teardown() {
    teardown_test_env
}

@test "restore.sh: accepts --help flag" {
    cd "$PROJECT_DIR"
    run scripts/restore.sh --help
    assert_success
    assert_output --partial "Usage:"
    assert_output --partial "restore"
}

@test "restore.sh: accepts --list flag" {
    cd "$PROJECT_DIR"
    run scripts/restore.sh --list
    assert_success
    assert_output --partial "Available backups"
}

@test "restore.sh: validates backup name" {
    cd "$PROJECT_DIR"
    run scripts/restore.sh -y "../invalid"
    assert_failure
    assert_output --partial "Invalid backup name format"
}

@test "restore.sh: restores from specified backup" {
    cd "$PROJECT_DIR"

    # Set a backup reference
    echo "test-backup" > "$BACKUP_REF_FILE"

    run scripts/restore.sh -y test-backup
    assert_success
    assert_output --partial "Restoring from backup"
}

@test "restore.sh: uses most recent backup when none specified" {
    cd "$PROJECT_DIR"

    # Set a backup reference
    echo "2024_01_27_120000" > "$BACKUP_REF_FILE"

    run scripts/restore.sh -y
    assert_success
    assert_output --partial "Restoring from backup"
}

@test "restore.sh: accepts --start flag" {
    cd "$PROJECT_DIR"
    echo "test-backup" > "$BACKUP_REF_FILE"

    run scripts/restore.sh -s -y test-backup
    assert_success
}

@test "restore.sh: uses error function for failures" {
    cd "$PROJECT_DIR"

    # Create a mock that fails
    cat > "$TEST_DIR/docker" <<'EOF'
#!/bin/bash
if [ "$1" = "compose" ] && [ "$2" = "run" ]; then
    echo "Restore failed!" >&2
    exit 1
elif [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
    echo "NAME    STATE"
    exit 0
fi
exit 0
EOF
    chmod +x "$TEST_DIR/docker"

    run scripts/restore.sh -y test-backup
    assert_failure
    assert_output --partial "ERROR:"
}

@test "restore.sh: requires services to be stopped" {
    skip "TODO: restore.sh does not currently check for running services"
    cd "$PROJECT_DIR"

    # Mock shows services running
    cat > "$TEST_DIR/docker" <<'EOF'
#!/bin/bash
if [ "$1" = "compose" ] && [ "$2" = "ps" ]; then
    if [[ "$*" == *"--format json"* ]]; then
        echo '{"Name":"test","State":"running","Health":"healthy"}'
    else
        echo "NAME    STATE"
        echo "test    Up"
    fi
    exit 0
fi
if [ "$1" = "compose" ] && [ "$2" = "run" ]; then
    exit 0
fi
exit 0
EOF
    chmod +x "$TEST_DIR/docker"

    run scripts/restore.sh -y test-backup
    assert_failure
    assert_output --partial "Services are still running"
}

@test "restore.sh: fails when backup name not found" {
    cd "$PROJECT_DIR"

    # No backup reference file
    run scripts/restore.sh -y
    assert_failure
    assert_output --partial "No backup specified"
}
