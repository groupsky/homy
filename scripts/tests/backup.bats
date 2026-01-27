#!/usr/bin/env bats

load test_helper

setup() {
    setup_test_env
    mock_docker_compose

    # Copy scripts to test directory
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/scripts/docker-helper.sh"
    cp "${BATS_TEST_DIRNAME}/../backup.sh" "$PROJECT_DIR/scripts/backup.sh"

    # Make scripts executable
    chmod +x "$PROJECT_DIR/scripts/backup.sh"
    chmod +x "$PROJECT_DIR/scripts/docker-helper.sh"

    # Mock volman container
    cat > "$TEST_DIR/docker" <<'EOF'
#!/bin/bash
if [ "$1" = "compose" ]; then
    shift
    if [ "$1" = "run" ] && [ "$3" = "volman" ]; then
        if [ "$4" = "backup" ]; then
            backup_name="${5:-$(date +%Y_%m_%d_%H_%M_%S)}"
            echo "Creating backup $backup_name"
            echo "Backup completed successfully"
            exit 0
        elif [ "$4" = "list" ]; then
            echo "Available backups:"
            echo "  2024_01_27_120000"
            echo "  2024_01_26_180000"
            exit 0
        fi
    elif [ "$1" = "stop" ] || [ "$1" = "start" ]; then
        exit 0
    fi
fi
exit 0
EOF
    chmod +x "$TEST_DIR/docker"
    export PATH="$TEST_DIR:$PATH"
}

teardown() {
    teardown_test_env
}

@test "backup.sh: accepts --help flag" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh --help
    assert_success
    assert_output --partial "Usage:"
    assert_output --partial "backup"
}

@test "backup.sh: accepts --list flag" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh --list
    assert_success
    assert_output --partial "Available backups"
}

@test "backup.sh: validates backup name" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh "../invalid"
    assert_failure
    assert_output --partial "Invalid backup name format"
}

@test "backup.sh: creates backup with custom name" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh -y test-backup
    assert_success
    assert_output --partial "Creating backup"
}

@test "backup.sh: creates backup with auto-generated name" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh -y
    assert_success
    assert_output --partial "Creating backup"
}

@test "backup.sh: saves backup reference" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh -y test-backup-ref
    assert_success

    # Check that backup reference was saved
    [ -f "$BACKUP_REF_FILE" ]
}

@test "backup.sh: accepts --stop flag" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh -s -y test-backup
    assert_success
}

@test "backup.sh: accepts --quiet flag" {
    cd "$PROJECT_DIR"
    run scripts/backup.sh -q test-backup
    assert_success
    # Output should be minimal in quiet mode
}

@test "backup.sh: uses error function for failures" {
    cd "$PROJECT_DIR"

    # Create a mock that fails
    cat > "$TEST_DIR/docker" <<'EOF'
#!/bin/bash
if [ "$1" = "compose" ] && [ "$2" = "run" ]; then
    echo "Backup failed!" >&2
    exit 1
fi
exit 0
EOF
    chmod +x "$TEST_DIR/docker"

    run scripts/backup.sh -y test-backup
    assert_failure
    assert_output --partial "ERROR:"
}

@test "backup.sh: handles backup name extraction with portable grep" {
    cd "$PROJECT_DIR"

    # Create a mock that returns output with backup name
    cat > "$TEST_DIR/docker" <<'EOF'
#!/bin/bash
if [ "$1" = "compose" ]; then
    shift
    if [ "$1" = "run" ] && [ "$3" = "volman" ] && [ "$4" = "backup" ]; then
        # Return a specific backup name
        echo "Creating backup 2024_01_27_153000"
        echo "Backup completed successfully"
        exit 0
    elif [ "$1" = "stop" ] || [ "$1" = "start" ]; then
        exit 0
    fi
fi
exit 0
EOF
    chmod +x "$TEST_DIR/docker"

    run scripts/backup.sh -y
    assert_success
    assert_output --partial "Backup created: 2024_01_27_153000"
}
