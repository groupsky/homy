# Deployment Scripts Tests

This directory contains automated tests for the deployment scripts using the [BATS (Bash Automated Testing System)](https://github.com/bats-core/bats-core) framework.

## Overview

The test suite validates the functionality, error handling, and robustness of:
- `docker-helper.sh` - Core helper functions
- `backup.sh` - Backup operations
- `restore.sh` - Restore operations
- `deploy.sh` - Deployment operations
- `rollback.sh` - Rollback operations
- `sync-nvmrc.sh` - Node.js version synchronization for Renovate

## Running Tests Locally

### Prerequisites

```bash
# Initialize git submodules (BATS framework)
git submodule update --init --recursive
```

### Run All Tests

```bash
cd scripts/tests
./bats-core/bin/bats *.bats
```

### Run Specific Test File

```bash
cd scripts/tests
./bats-core/bin/bats docker-helper.bats
```

### Run with Verbose Output

```bash
cd scripts/tests
./bats-core/bin/bats -t *.bats
```

## Test Structure

### Test Files

- `docker-helper.bats` - Tests for core helper functions
- `backup.bats` - Tests for backup script
- `restore.bats` - Tests for restore script
- `sync-nvmrc.bats` - Tests for Node.js version synchronization
- `test_helper.bash` - Common test utilities and mocks

### Test Helper Functions

The `test_helper.bash` file provides:
- `setup_test_env()` - Creates isolated test environment
- `teardown_test_env()` - Cleans up after tests
- `mock_docker_compose()` - Mocks docker/docker-compose commands
- `source_docker_helper()` - Sources helper with mocked environment

### Test Patterns

Each test follows this pattern:

```bash
@test "component: description" {
    # Arrange - set up test conditions
    source_docker_helper "$PROJECT_DIR/docker-helper.sh"

    # Act - execute the function
    run some_function "arguments"

    # Assert - verify the result
    assert_success
    assert_output --partial "expected output"
}
```

## Continuous Integration

Tests run automatically on:
- Pull requests (all test files)
- Push to master branch (all test files)
- Manual workflow dispatch

See `.github/workflows/deployment-scripts-tests.yml` for CI configuration.

## Writing New Tests

### Adding Tests for Existing Scripts

1. Add test cases to the appropriate `.bats` file
2. Follow existing test naming conventions
3. Use descriptive test names: `"component: what it tests"`
4. Include both positive and negative test cases

### Adding Tests for New Scripts

1. Create a new `.bats` file: `scripts/tests/new-script.bats`
2. Include the test helper: `load test_helper`
3. Implement `setup()` and `teardown()` functions
4. Write comprehensive test cases

Example:

```bash
#!/usr/bin/env bats

load test_helper

setup() {
    setup_test_env
    mock_docker_compose
    # ... copy your script to test directory
}

teardown() {
    teardown_test_env
}

@test "new-script: basic functionality" {
    run scripts/new-script.sh --help
    assert_success
    assert_output --partial "Usage:"
}
```

## Test Coverage

Current test coverage:

### docker-helper.sh
- ✅ Version detection and docker-compose command selection
- ✅ Logging functions (log, error)
- ✅ Input validation (backup names, image tags)
- ✅ Atomic file operations
- ✅ Version management (save/get functions)
- ✅ Error function usage and formatting
- ✅ Security features (readonly DOCKER_COMPOSE_CMD, quoted variables)

### backup.sh
- ✅ Command-line argument parsing
- ✅ Backup name validation
- ✅ Backup creation with custom/auto-generated names
- ✅ Backup reference saving
- ✅ Error handling with error function
- ✅ Portable grep implementation
- ✅ Service stop/start operations

### restore.sh
- ✅ Command-line argument parsing
- ✅ Backup name validation
- ✅ Restore operations
- ✅ Service state validation
- ✅ Error handling with error function
- ✅ Backup reference resolution

### sync-nvmrc.sh
- ✅ Version extraction from standard Node.js images
- ✅ Version extraction from variant images (node-ubuntu, etc.)
- ✅ Multi-stage Dockerfile support
- ✅ Missing .nvmrc file handling
- ✅ Non-Node.js Dockerfile error handling
- ✅ Already-synced version detection (idempotency)
- ✅ Whitespace handling in .nvmrc
- ✅ Invalid arguments rejection
- ✅ Empty/comment-only Dockerfile handling

## Debugging Tests

### Enable Debug Output

```bash
# Run with debug output
cd scripts/tests
bash -x ./bats-core/bin/bats docker-helper.bats
```

### Check Test Environment

```bash
# Print test environment variables
@test "debug: print environment" {
    printenv | grep TEST
}
```

### Inspect Test Failures

When a test fails, BATS shows:
- Test name and line number
- Expected vs actual output
- Exit code (if checking success/failure)

## Dependencies

- **BATS Core**: Test framework
- **BATS Support**: Additional assertions and helpers
- **BATS Assert**: Assertion library
- **Bash 3.0+**: Shell interpreter
- **Docker**: For testing docker-compose interactions (mocked in tests)

## Best Practices

1. **Isolation**: Each test runs in isolation with its own temporary directory
2. **Mocking**: Mock external dependencies (docker, jq, curl) instead of requiring them
3. **Cleanup**: Always clean up test artifacts in `teardown()`
4. **Descriptive Names**: Use clear, descriptive test names
5. **Single Assertion**: Each test should verify one specific behavior
6. **Positive and Negative**: Test both success and failure cases

## Troubleshooting

### Tests fail with "command not found"

Make sure git submodules are initialized:
```bash
git submodule update --init --recursive
```

### Tests fail with "permission denied"

Make sure test scripts are executable:
```bash
chmod +x scripts/tests/*.bats
```

### Mock docker commands not working

Verify PATH includes test directory:
```bash
echo $PATH | grep -q "$TEST_DIR" || export PATH="$TEST_DIR:$PATH"
```

## References

- [BATS Documentation](https://bats-core.readthedocs.io/)
- [BATS Support Library](https://github.com/bats-core/bats-support)
- [BATS Assert Library](https://github.com/bats-core/bats-assert)
