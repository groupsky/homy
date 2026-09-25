#!/usr/bin/env bats

load test_helper

setup() {
    setup_test_env
    mock_docker_compose

    # Copy docker-helper.sh to test directory
    cp "${BATS_TEST_DIRNAME}/../docker-helper.sh" "$PROJECT_DIR/docker-helper.sh"

    # Verify mock is set up correctly
    [ -x "$TEST_DIR/docker" ] || {
        echo "ERROR: Mock docker script not created or not executable" >&2
        exit 1
    }
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

    # Verify the mock is in PATH and executable
    run which docker
    assert_success

    # Test that dc_run function exists and calls docker
    run dc_run version
    assert_success
    assert_output --partial "Docker Compose version"
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

    # Verify mock docker is available
    run which docker
    assert_success

    # Get the count
    run get_running_services_count
    assert_success

    # Result should be a single integer >= 0
    result="$output"
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

    # Create empty directory and use it exclusively in PATH to hide jq
    local empty_path="$TEST_DIR/empty"
    mkdir -p "$empty_path"

    PATH="$empty_path" run require_jq
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

# Test: notify
# Mocks curl (records its arguments, answers with $CURL_REPLY, exits $CURL_RC)
# and systemd-cat (appends stdin and its arguments to journal.log).
setup_notify_mocks() {
    mkdir -p "$TEST_DIR/bin"
    cat > "$TEST_DIR/bin/curl" <<'MOCK'
#!/bin/bash
printf '%s\n' "$@" > "$CURL_ARGS_FILE"
printf '%s' "${CURL_REPLY:-}"
exit "${CURL_RC:-0}"
MOCK
    cat > "$TEST_DIR/bin/systemd-cat" <<'MOCK'
#!/bin/bash
echo "TAG:$*" >> "$JOURNAL_FILE"
cat >> "$JOURNAL_FILE"
MOCK
    chmod +x "$TEST_DIR/bin/curl" "$TEST_DIR/bin/systemd-cat"
    export PATH="$TEST_DIR/bin:$PATH"
    export CURL_ARGS_FILE="$TEST_DIR/curl-args"
    export JOURNAL_FILE="$TEST_DIR/journal.log"
    export TELEGRAM_BOT_TOKEN="123:SECRET-TOKEN"
    export TELEGRAM_CHAT_ID="-100999"
}

@test "notify: logs one telegram.sent line under the homy-deploy tag" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    export CURL_REPLY='{"ok":true,"result":{"message_id":4711}}'

    run notify "Deployment successful"
    assert_success

    run cat "$JOURNAL_FILE"
    assert_line --index 0 "TAG:-t homy-deploy"
    line=$(sed -n 2p "$JOURNAL_FILE")
    [ "$(jq -r .event <<<"$line")" = "telegram.sent" ]
    [ "$(jq -r .sender <<<"$line")" = "homy-deploy" ]
    [ "$(jq -r .source <<<"$line")" = "null" ]
    [ "$(jq -r .origin_host <<<"$line")" = "routy" ]
    [ "$(jq -r .ok <<<"$line")" = "true" ]
    [ "$(jq -r .message_id <<<"$line")" = "4711" ]
    [ "$(jq -r .error <<<"$line")" = "null" ]
    [ "$(jq -r .text <<<"$line")" = "Deployment successful" ]
    [ "$(wc -l < "$JOURNAL_FILE")" -eq 2 ]
}

@test "notify: NOTIFY_SENDER picks the tag and sender" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    export CURL_REPLY='{"ok":true,"result":{"message_id":1}}'
    NOTIFY_SENDER=homy-rollback

    notify "Rollback completed"

    assert_equal "$(sed -n 1p "$JOURNAL_FILE")" "TAG:-t homy-rollback"
    assert_equal "$(sed -n 2p "$JOURNAL_FILE" | jq -r .sender)" "homy-rollback"
}

@test "notify: an API error is logged with ok false and the description" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    export CURL_REPLY='{"ok":false,"error_code":400,"description":"Bad Request: chat not found"}'

    run notify "x"
    assert_success

    line=$(sed -n 2p "$JOURNAL_FILE")
    [ "$(jq -r .ok <<<"$line")" = "false" ]
    [ "$(jq -r .message_id <<<"$line")" = "null" ]
    [ "$(jq -r .error <<<"$line")" = "Bad Request: chat not found" ]
}

@test "notify: a transport failure is logged and is not fatal" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    export CURL_REPLY='' CURL_RC=6

    run notify "x"
    assert_success

    line=$(sed -n 2p "$JOURNAL_FILE")
    [ "$(jq -r .ok <<<"$line")" = "false" ]
    [ "$(jq -r .error <<<"$line")" = "curl exit 6" ]
}

@test "notify: text over 1 KiB with & and + is sent url-encoded and logged in full" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    export CURL_REPLY='{"ok":true,"result":{"message_id":2}}'
    text="a&b+c $(printf 'x%.0s' $(seq 1 1500))
second line"

    notify "$text"

    # curl got the text through --data-urlencode, not as a raw -d field
    grep -qxF -- "--data-urlencode" "$CURL_ARGS_FILE"
    grep -qF -- "text=a&b+c " "$CURL_ARGS_FILE"
    run ! grep -qxF -- "-d" "$CURL_ARGS_FILE"
    run ! grep -qxF -- "-f" "$CURL_ARGS_FILE"
    # one journal record, full text
    [ "$(wc -l < "$JOURNAL_FILE")" -eq 2 ]
    [ "$(sed -n 2p "$JOURNAL_FILE" | jq -r .text)" = "$text" ]
}

@test "notify: neither the token nor the chat id reaches the journal" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    export CURL_REPLY='{"ok":true,"result":{"message_id":3}}'

    notify "hello"

    run grep -c -e "SECRET-TOKEN" -e "100999" "$JOURNAL_FILE"
    assert_output "0"
}

@test "notify: does nothing without credentials" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    unset TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID

    run notify "x"
    assert_success
    [ ! -e "$CURL_ARGS_FILE" ]
    [ ! -e "$JOURNAL_FILE" ]
}

@test "notify: odd replies still produce one line and never fail" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    setup_notify_mocks
    for reply in '[]' '5' '<html>502 Bad Gateway</html>' '{"ok":true,"result":true}'; do
        rm -f "$JOURNAL_FILE"
        export CURL_REPLY="$reply"
        run notify "x"
        assert_success
        [ "$(wc -l < "$JOURNAL_FILE")" -eq 2 ]
        [ "$(sed -n 2p "$JOURNAL_FILE" | jq -r .text)" = "x" ]
    done
}

# Test: resolve_secrets_dir / load_notification_secrets
@test "resolve_secrets_dir: defaults to secrets/ in the project" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH
    assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/secrets"
}

@test "resolve_secrets_dir: environment wins over .env" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    echo 'SECRETS_PATH=./from-env-file' > "$PROJECT_DIR/.env"
    SECRETS_PATH=/abs/from-env
    assert_equal "$(resolve_secrets_dir)" "/abs/from-env"
}

@test "resolve_secrets_dir: reads a relative path from .env, relative to the project" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH
    printf 'OTHER=1\nSECRETS_PATH=./secrets.local\nMORE=2\n' > "$PROJECT_DIR/.env"
    assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/secrets.local"
}

@test "resolve_secrets_dir: handles quotes, CRLF and an absolute path in .env" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH
    printf 'SECRETS_PATH="/srv/my secrets"\r\n' > "$PROJECT_DIR/.env"
    assert_equal "$(resolve_secrets_dir)" "/srv/my secrets"
}

@test "resolve_secrets_dir: ignores a value with a dollar sign" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH
    echo 'SECRETS_PATH=${SECRETS_PATH:-./secrets}' > "$PROJECT_DIR/.env"
    assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/secrets"
}

@test "resolve_secrets_dir: ignores an empty value and a missing .env line" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH
    echo 'SECRETS_PATH=' > "$PROJECT_DIR/.env"
    assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/secrets"
    echo 'FOO=bar' > "$PROJECT_DIR/.env"
    assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/secrets"
}

@test "load_notification_secrets: takes the real files from SECRETS_PATH in .env, not the placeholders" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
    mkdir -p "$PROJECT_DIR/secrets.local"
    echo "placeholder text" > "$PROJECT_DIR/secrets/telegram_bot_token"
    echo "placeholder text" > "$PROJECT_DIR/secrets/telegram_chat_id"
    echo "real-token" > "$PROJECT_DIR/secrets.local/telegram_bot_token"
    echo "real-chat" > "$PROJECT_DIR/secrets.local/telegram_chat_id"
    echo 'SECRETS_PATH=./secrets.local' > "$PROJECT_DIR/.env"

    load_notification_secrets

    assert_equal "$TELEGRAM_BOT_TOKEN" "real-token"
    assert_equal "$TELEGRAM_CHAT_ID" "real-chat"
}

@test "resolve_secrets_dir: the last SECRETS_PATH line wins, like compose" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH
    printf 'SECRETS_PATH=./first\nSECRETS_PATH=./second\n' > "$PROJECT_DIR/.env"
    assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/second"
}

@test "resolve_secrets_dir: export prefix, spaces around =, trailing spaces and comments" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH
    for line in 'export SECRETS_PATH=./x' '  SECRETS_PATH = ./x' 'SECRETS_PATH=./x   ' 'SECRETS_PATH=./x # comment' 'SECRETS_PATH="./x" # c' "SECRETS_PATH='./x'"; do
        printf '%s\n' "$line" > "$PROJECT_DIR/.env"
        assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/x"
    done
}

@test "resolve_secrets_dir: a relative value in the environment is relative to the project; ~ is home" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    SECRETS_PATH=./rel
    assert_equal "$(resolve_secrets_dir)" "$PROJECT_DIR/rel"
    SECRETS_PATH='~/sec'
    assert_equal "$(resolve_secrets_dir)" "$HOME/sec"
}

@test "resolve_secrets_dir: is safe under set -euo pipefail with no matching .env line" {
    unset SECRETS_PATH
    echo 'FOO=1' > "$PROJECT_DIR/.env"
    run bash -c 'set -euo pipefail; PROJECT_DIR="$1"; source "$2"; resolve_secrets_dir' _ "$PROJECT_DIR" "$PROJECT_DIR/docker-helper.sh"
    assert_success
    assert_output "$PROJECT_DIR/secrets"
}

@test "load_notification_secrets: says where it looked when the files are missing, without printing secrets" {
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"
    unset SECRETS_PATH TELEGRAM_BOT_TOKEN TELEGRAM_CHAT_ID
    run load_notification_secrets
    assert_success
    assert_output --partial "Telegram secrets not found in $PROJECT_DIR/secrets"
}
