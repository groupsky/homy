# GitHub Scripts Tests

This directory contains BATS (Bash Automated Testing System) tests for GitHub scripts.

## Running Tests

### Install BATS

If not already installed, you can use the BATS installation from the main `scripts/tests/` directory:

```bash
# Run from repository root
cd scripts/tests
./bats-core/bin/bats ../../.github/scripts/tests/*.bats
```

Or install BATS separately:

```bash
git clone https://github.com/bats-core/bats-core.git
cd bats-core
./install.sh /usr/local
```

### Run All Tests

```bash
# From repository root
bats .github/scripts/tests/*.bats
```

### Run Specific Test File

```bash
bats .github/scripts/tests/sync-nvmrc.bats
```

## Test Coverage

### sync-nvmrc.bats

Tests for the `.github/scripts/sync-nvmrc.sh` script used by Renovate's postUpgradeTasks:

- ✅ Version extraction from standard Node.js images
- ✅ Version extraction from variant images (node-ubuntu, etc.)
- ✅ Multi-stage Dockerfile support
- ✅ Missing .nvmrc file handling
- ✅ Non-Node.js Dockerfile error handling
- ✅ Already-synced version detection (idempotency)
- ✅ Whitespace handling in .nvmrc
- ✅ Invalid arguments rejection
- ✅ Empty/comment-only Dockerfile handling

## CI Integration

These tests can be integrated into the CI pipeline to ensure script correctness on all PRs that modify scripts.

Example workflow:

```yaml
- name: Test GitHub scripts
  run: |
    cd scripts/tests
    ./bats-core/bin/bats ../../.github/scripts/tests/*.bats
```
