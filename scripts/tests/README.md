# Deployment Scripts Tests

This directory contains automated tests for the deployment scripts using the [BATS (Bash Automated Testing System)](https://github.com/bats-core/bats-core) framework.

## Overview

The test suite validates the functionality, error handling, and robustness of:
- `docker-helper.sh` - Core helper functions
- `backup.sh` - Backup operations
- `restore.sh` - Restore operations
- `deploy.sh` - Deployment operations
- `rollback.sh` - Rollback operations

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
- `deploy.bats` - Tests for the deploy script's code-update step
- `deploy-flow.bats` - deploy.sh end to end: snapshot first, only changed services, health gate, rollback
- `snapshot.bats` - snapshot.sh: dataset resolution, one-dataset check, free space, exact name
- `changed-services.bats` - digest override, config-file hash, which services changed
- `health-gate.bats` - the health gate: start periods, 30 s rule, one-shot skip, cannot-check
- `restore-snapshot.bats` - the manual data restore from a deploy snapshot, on a scratch directory
- `volman.bats` - volman's COMPLETE marker (`seal`) and restore refusal
- `rollback.bats` - rollback.sh requires an explicit backup and does not recreate on failure
- `compose-real.sh` - not bats: runs the deploy's override and `up` against a real docker compose 2.18.1 on a throwaway project (CI job `compose-real`; needs docker and network)
- `test_helper.bash` - Common test utilities and mocks
- `mock_stack.bash` - A fake `docker` (compose, inspect, image inspect) and `zfs` backed by files

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

### deploy.sh
- ✅ Code update runs with submodule recursion disabled (issue #1406)
- ✅ Checkout precedes pull, submodules are updated afterwards
- ✅ A failed submodule update warns instead of aborting the deploy
- ✅ A genuinely failed checkout or pull stops the deploy
- ✅ `--tag` skips the code update entirely

`deploy.bats` mocks `git` as a host with `submodule.recurse=true` in its global
config: the mock's `pull` fails with `fatal: bad object 0000...0` unless the
caller disabled recursion for the invocation. That is the failure observed on
routy, so the tests fail against a `deploy.sh` that pulls plainly.

### Fast deploy (#1607)
- ✅ A failed or impossible snapshot stops the deploy before code, images or containers are touched; `--skip-snapshot` goes on without one
- ✅ The snapshot name is exactly `<dataset>@homy-deploy-<UTC yyyymmddThhmmssZ>-<short sha>`
- ✅ Refused when data spans datasets, is not on ZFS, is in a Docker volume, or the pool is low on space
- ✅ No stop, no `down`, no backup during a deploy; `up` runs with digest pins, `--no-build`, `--pull never`
- ✅ Only services whose image, compose config or mounted config files changed are passed to `up` (`--no-deps`), recreated and gated
- ✅ A service with two containers is refused; a hanging `up` times out and counts as failed
- ✅ A failed service the rollback does not recreate (host-side cause) fails the rollback
- ✅ Health gate: start periods, the 30 s restart-count rule, one-shot services skipped, fails loudly when it cannot check
- ✅ Rollback: stateless = code and images back, no data restore; stateful with a new image = stop and alert
- ✅ `restore-snapshot.sh` asks first, stops only the affected services, keeps the current data aside
- ✅ `backup.sh --stop` refuses to copy a running stack and seals only complete backups; restore refuses unsealed ones

`mock_stack.bash` keeps the fake stack in files under `$MOCK_DIR` (see its
header). The health gate's clock and sleep are shell functions the tests
replace, so waits of minutes run in milliseconds.

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
