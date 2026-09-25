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

@test "backup.sh: dumps MongoDB through volman into the new backup" {
    cd "$PROJECT_DIR"
    cat > "$TEST_DIR/docker" <<'MOCK'
#!/bin/bash
echo "$*" >> "$TEST_DIR/calls.log"
if [ "$1" = "compose" ]; then
    shift
    if [ "$1" = "run" ] && [ "$4" = "backup" ]; then
        echo "Creating backup 2024_01_27_153000"
    fi
    if [ "$1" = "run" ] && [ "$5" = "store" ]; then
        cat > /dev/null
    fi
    if [ "$1" = "exec" ] && [[ "$*" == *mongodump* ]]; then
        echo "dump-bytes"
    fi
fi
exit 0
MOCK
    chmod +x "$TEST_DIR/docker"
    export TEST_DIR

    run scripts/backup.sh -y
    assert_success
    run grep -c "compose exec -T mongo sh -c mongodump" "$TEST_DIR/calls.log"
    assert_output "1"
    run grep "volman store 2024_01_27_153000 mongo.archive.gz" "$TEST_DIR/calls.log"
    assert_success
}

@test "backup.sh: a failing mongodump fails the backup" {
    cd "$PROJECT_DIR"
    cat > "$TEST_DIR/docker" <<'MOCK'
#!/bin/bash
if [ "$1" = "compose" ]; then
    shift
    if [ "$1" = "run" ] && [ "$4" = "backup" ]; then
        echo "Creating backup 2024_01_27_153000"
    fi
    # the ping succeeds, the dump does not
    if [ "$1" = "run" ] && [ "$5" = "store" ]; then
        cat > /dev/null
    fi
    if [ "$1" = "exec" ] && [[ "$*" == *mongodump* ]]; then
        exit 1
    fi
fi
exit 0
MOCK
    chmod +x "$TEST_DIR/docker"

    run scripts/backup.sh -y
    assert_failure
    assert_output --partial "MongoDB dump failed"
}

# --- --stop must really stop, and only a complete backup is sealed (#1589, #1590)

# A docker mock with one container whose state lives in $TEST_DIR/state
# ("running<TAB>started"). `stop` stops it unless $TEST_DIR/stop-noop exists;
# the volman backup starts it again when $TEST_DIR/start-during-backup exists.
setup_stateful_mock() {
    printf 'true\t2026-09-25T10:00:00Z\n' > "$TEST_DIR/state"
    cat > "$TEST_DIR/docker" <<'MOCK'
#!/bin/bash
echo "$*" >> "$TEST_DIR/calls.log"
S="$TEST_DIR/state"
if [ "$1" = "compose" ]; then
    shift
    case "$1" in
        version) echo "2.29.1" ;;
        stop) [ -e "$TEST_DIR/stop-noop" ] || printf 'false\t%s\n' "$(cut -f2 "$S")" > "$S" ;;
        start) ;;
        ps) echo "c1" ;;
        run)
            if [ "$4" = "backup" ]; then
                echo "Creating backup 2024_01_27_153000"
                if [ -e "$TEST_DIR/start-during-backup" ]; then
                    printf 'true\t2026-09-25T11:00:00Z\n' > "$S"
                fi
            fi
            if [[ " $* " == *" store "* ]]; then cat > /dev/null; fi
            ;;
        exec) [[ "$*" == *mongodump* ]] && echo "dump-bytes" ;;
    esac
    exit 0
fi
if [ "$1" = "inspect" ]; then
    IFS=$'\t' read -r running started < "$S"
    echo "[{\"Name\":\"/homy-influxdb-1\",\"State\":{\"Running\":$running,\"StartedAt\":\"$started\"}}]"
fi
exit 0
MOCK
    chmod +x "$TEST_DIR/docker"
    export TEST_DIR
}

@test "backup.sh --stop: seals a backup taken with everything stopped" {
    cd "$PROJECT_DIR"
    setup_stateful_mock

    run scripts/backup.sh -s -y
    assert_success
    run grep "volman seal" "$TEST_DIR/calls.log"
    assert_output --partial "compose run --rm volman seal 2024_01_27_153000 stopped"
    # sealed only after the Mongo dump
    run grep -n -e "mongodump" -e "volman seal" "$TEST_DIR/calls.log"
    [[ "${lines[0]}" == *mongodump* ]]
    [[ "${lines[1]}" == *"volman seal"* ]]
    [ "$(cat "$BACKUP_REF_FILE")" = "2024_01_27_153000" ]
}

@test "backup.sh --stop: refuses to back up when a container is still running after stop" {
    cd "$PROJECT_DIR"
    setup_stateful_mock
    touch "$TEST_DIR/stop-noop"

    run scripts/backup.sh -s -y
    assert_failure
    assert_output --partial "Still running after stop; not backing up: /homy-influxdb-1"
    run grep -c "volman backup" "$TEST_DIR/calls.log"
    assert_output "0"
    run grep -c "compose start" "$TEST_DIR/calls.log"
    assert_output "1"
}

@test "backup.sh --stop: a container started during the copy leaves the backup unsealed" {
    cd "$PROJECT_DIR"
    setup_stateful_mock
    touch "$TEST_DIR/start-during-backup"

    run scripts/backup.sh -s -y
    assert_failure
    assert_output --partial "Containers started while backup 2024_01_27_153000 was being written"
    assert_output --partial "left without its COMPLETE marker"
    run grep -c "volman seal" "$TEST_DIR/calls.log"
    assert_output "0"
    [ ! -e "$BACKUP_REF_FILE" ]
}

@test "backup.sh: a backup of the running stack is sealed as such" {
    cd "$PROJECT_DIR"
    setup_stateful_mock

    run scripts/backup.sh -y
    assert_success
    run grep "volman seal" "$TEST_DIR/calls.log"
    assert_output --partial "volman seal 2024_01_27_153000 running"
}

@test "backup.sh: a failed Mongo dump leaves the backup unsealed" {
    cd "$PROJECT_DIR"
    setup_stateful_mock
    sed -i 's/exec) \[\[ "\$\*" == \*mongodump\* \]\] && echo "dump-bytes" ;;/exec) [[ "$*" == *mongodump* ]] \&\& exit 1 ;;/' "$TEST_DIR/docker"

    run scripts/backup.sh -s -y
    assert_failure
    run grep -c "volman seal" "$TEST_DIR/calls.log"
    assert_output "0"
}
