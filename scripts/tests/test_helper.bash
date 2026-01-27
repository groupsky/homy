#!/usr/bin/env bash

# Load BATS support libraries
load 'bats-support/load'
load 'bats-assert/load'

# Setup test environment
setup_test_env() {
    # Create temporary test directory
    export TEST_DIR="${BATS_TEST_TMPDIR}/test-$$"
    mkdir -p "$TEST_DIR"

    # Create mock project structure
    export PROJECT_DIR="$TEST_DIR/project"
    mkdir -p "$PROJECT_DIR"
    mkdir -p "$PROJECT_DIR/logs"
    mkdir -p "$PROJECT_DIR/secrets"

    # Create mock docker-compose.yml
    cat > "$PROJECT_DIR/docker-compose.yml" <<'EOF'
version: '3.8'
services:
  test:
    image: alpine:latest
EOF

    # Set environment variables
    export SCRIPT_DIR="$PROJECT_DIR/scripts"
    export LOCK_FILE="$TEST_DIR/test-lock"
    export VERSION_FILE="$TEST_DIR/.deployed-version"
    export PREVIOUS_VERSION_FILE="$TEST_DIR/.previous-version"
    export BACKUP_REF_FILE="$TEST_DIR/.pre-upgrade-backup"
    export QUIET=1
    export YES_FLAG=1
    export SKIP_LOCK=1

    # Mock docker-compose command
    export DOCKER_COMPOSE_CMD="docker compose"
}

# Cleanup test environment
teardown_test_env() {
    if [ -n "$TEST_DIR" ] && [ -d "$TEST_DIR" ]; then
        rm -rf "$TEST_DIR"
    fi
}

# Create a mock docker-compose command
mock_docker_compose() {
    local mock_script="$TEST_DIR/docker"
    mkdir -p "$(dirname "$mock_script")"

    cat > "$mock_script" <<'EOF'
#!/bin/bash
# Mock docker command
if [ "$1" = "compose" ]; then
    shift
    case "$1" in
        version)
            echo "Docker Compose version v2.24.0"
            exit 0
            ;;
        ps)
            if [[ "$*" == *"--format json"* ]]; then
                echo '[{"Name":"test","State":"running","Health":"healthy"}]'
            else
                echo "NAME    STATE"
                echo "test    Up"
            fi
            exit 0
            ;;
        *)
            exit 0
            ;;
    esac
fi
EOF

    chmod +x "$mock_script"
    export PATH="$TEST_DIR:$PATH"
}

# Source the docker-helper.sh with mocked environment
source_docker_helper() {
    # Create a wrapper that sources the actual helper
    local helper_path="$1"

    # Override detect_docker_compose to avoid errors in test environment
    detect_docker_compose() {
        echo "docker compose"
    }
    export -f detect_docker_compose

    # Source the helper (will use our mocked function)
    # shellcheck source=../docker-helper.sh
    source "$helper_path"
}
