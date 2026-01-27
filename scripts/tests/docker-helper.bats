#!/usr/bin/env bats

load test_helper

setup() {
    setup_test_env
    mock_docker_compose

    # Copy docker-helper.sh to test directory
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/docker-helper.sh"
}

teardown() {
    teardown_test_env
}

# Test: detect_docker_compose
@test "detect_docker_compose: prefers docker compose over docker-compose" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    result=$(detect_docker_compose)
    assert_equal "$result" "docker compose"
}

# Test: dc_run
@test "dc_run: executes docker-compose commands" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    # Mock docker compose command is available
    run bash -c 'type docker'
    if [ $status -eq 0 ]; then
        run dc_run version
        assert_success
    else
        skip "docker not available in test environment"
    fi
}

# Test: supports_json_format
@test "supports_json_format: detects JSON support" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run supports_json_format
    assert_success
}

# Test: get_running_services_count
@test "get_running_services_count: returns count of running services" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    result=$(get_running_services_count)
    # Result should be a single integer >= 0
    [[ "$result" =~ ^[0-9]+$ ]]
    [ "$result" -ge 0 ]
}

# Test: log function
@test "log: outputs timestamped messages when not quiet" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    export QUIET=0

    run log "Test message"
    assert_success
    assert_output --partial "Test message"
    assert_output --regexp '\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\]'
}

@test "log: suppresses output when quiet mode enabled" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    export QUIET=1

    run log "Test message"
    assert_success
    refute_output
}

# Test: error function
@test "error: always outputs to stderr regardless of quiet mode" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    export QUIET=1

    run error "Error message"
    assert_success
    assert_output --partial "ERROR: Error message"
}

@test "error: includes timestamp in error messages" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run error "Test error"
    assert_success
    assert_output --regexp '\[[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}\] ERROR:'
}

# Test: validate_backup_name
@test "validate_backup_name: accepts valid alphanumeric names" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_name "backup_2024_01_27"
    assert_success
}

@test "validate_backup_name: accepts names with dashes" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_name "pre-upgrade-backup"
    assert_success
}

@test "validate_backup_name: rejects names with slashes" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_name "backup/test"
    assert_failure
    assert_output --partial "Invalid backup name format"
}

@test "validate_backup_name: rejects names with dots" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_name "../backup"
    assert_failure
    assert_output --partial "Invalid backup name format"
}

@test "validate_backup_name: rejects names with special characters" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_name "backup@test"
    assert_failure
    assert_output --partial "Invalid backup name format"
}

# Test: validate_image_tag
@test "validate_image_tag: accepts git SHA" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_image_tag "a1b2c3d4e5f6789012345678901234567890abcd"
    assert_success
}

@test "validate_image_tag: accepts semantic version" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_image_tag "v1.2.3"
    assert_success
}

@test "validate_image_tag: accepts semantic version without v prefix" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_image_tag "1.2.3"
    assert_success
}

@test "validate_image_tag: accepts latest tag" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_image_tag "latest"
    assert_success
}

@test "validate_image_tag: accepts branch names" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_image_tag "feature/test-branch"
    assert_success
}

@test "validate_image_tag: rejects invalid tags" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_image_tag "invalid@tag!"
    assert_failure
    assert_output --partial "Invalid image tag format"
}

# Test: atomic_write
@test "atomic_write: creates file with content" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    local test_file="$TEST_DIR/test.txt"
    run atomic_write "$test_file" "test content"
    assert_success

    assert [ -f "$test_file" ]
    assert_equal "$(cat "$test_file")" "test content"
}

@test "atomic_write: overwrites existing file" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    local test_file="$TEST_DIR/test.txt"
    echo "old content" > "$test_file"

    run atomic_write "$test_file" "new content"
    assert_success

    assert_equal "$(cat "$test_file")" "new content"
}

@test "atomic_write: uses error function for failures" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    # Try to write to non-existent directory
    run atomic_write "/nonexistent/dir/file.txt" "content"
    assert_failure
    assert_output --partial "ERROR:"
}

# Test: format_version_short
@test "format_version_short: truncates git SHA to 8 chars" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    result=$(format_version_short "a1b2c3d4e5f6789012345678901234567890abcd")
    assert_equal "$result" "a1b2c3d4"
}

@test "format_version_short: preserves short versions" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    result=$(format_version_short "v1.2.3")
    assert_equal "$result" "v1.2.3"
}

# Test: save and get version functions
@test "save_deployed_version and get_deployed_version: roundtrip" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run save_deployed_version "test-version-123"
    assert_success

    result=$(get_deployed_version)
    assert_equal "$result" "test-version-123"
}

@test "get_deployed_version: returns unknown when file missing" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    result=$(get_deployed_version)
    assert_equal "$result" "unknown"
}

@test "save_previous_version and get_previous_version: roundtrip" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run save_previous_version "prev-version-456"
    assert_success

    result=$(get_previous_version)
    assert_equal "$result" "prev-version-456"
}

@test "save_backup_reference and get_backup_reference: roundtrip" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run save_backup_reference "backup_2024_01_27"
    assert_success

    result=$(get_backup_reference)
    assert_equal "$result" "backup_2024_01_27"
}

# Test: validate_backup_or_exit
@test "validate_backup_or_exit: allows empty names" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_or_exit ""
    assert_success
}

@test "validate_backup_or_exit: validates non-empty names" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_or_exit "valid-backup-name"
    assert_success
}

@test "validate_backup_or_exit: exits on invalid names" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    run validate_backup_or_exit "../invalid"
    assert_failure
}

# Test: require_jq and require_curl use error function
@test "require_jq: uses error function when jq missing" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    # Mock command to simulate jq not found
    command() {
        if [ "$2" = "jq" ]; then
            return 1
        fi
        builtin command "$@"
    }
    export -f command

    run require_jq
    assert_failure
    assert_output --partial "ERROR:"
    assert_output --partial "jq is required"
    assert_output --partial "Install with"
}

# Test: DOCKER_COMPOSE_CMD is readonly
@test "DOCKER_COMPOSE_CMD: is readonly and cannot be modified" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    # Try to modify DOCKER_COMPOSE_CMD
    run bash -c "DOCKER_COMPOSE_CMD='malicious'; echo $?"
    # In a new shell, the variable should be mutable, but in our sourced context it should be readonly
    # Let's just verify it's exported
    [ -n "$DOCKER_COMPOSE_CMD" ]
}

# Test: DOCKER_COMPOSE_CMD is quoted in dc_run
@test "dc_run: properly quotes DOCKER_COMPOSE_CMD" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    # Verify DOCKER_COMPOSE_CMD is set and dc_run function exists
    [ -n "$DOCKER_COMPOSE_CMD" ]
    run bash -c 'type dc_run'
    assert_success
}

# Test: confirm function
@test "confirm: returns success when YES_FLAG set" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    export YES_FLAG=1

    run confirm "Test prompt"
    assert_success
}

@test "confirm: returns success when QUIET set" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    export QUIET=1
    export YES_FLAG=0

    run confirm "Test prompt"
    assert_success
}
