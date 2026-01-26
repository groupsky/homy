# Docker-Compose Compatibility Refactoring Summary

## Overview

This refactoring adds support for both docker-compose 1.x (with dash) and docker compose 2.x (plugin) versions while consolidating common functionality into a shared helper library.

## Changes

### New File: `docker-helper.sh`

A comprehensive helper library that provides:

#### Docker Compose Compatibility
- **`detect_docker_compose()`**: Auto-detects whether to use `docker-compose` or `docker compose`
- **`dc_run()`**: Wrapper function for all docker-compose commands

#### Common Utilities
- **`log()`**: Timestamped logging with optional file output
- **`confirm()`**: User confirmation prompts with skip flag support
- **`notify()`**: Telegram notification integration
- **`load_notification_secrets()`**: Load Telegram credentials from secrets/

#### Locking & Validation
- **`acquire_lock()`**: Deployment lock with flock, supports conditional locking
- **`validate_backup_name()`**: Backup name format validation (security)
- **`validate_image_tag()`**: Image tag format validation (security)
- **`validate_compose_file()`**: Check docker-compose.yml exists
- **`require_jq()`**: Check jq availability with helpful error
- **`require_curl()`**: Check curl availability with helpful error

#### Service Management
- **`services_running()`**: Check if any services are running
- **`wait_for_health()`**: Wait for services to become healthy (checks both unhealthy and starting states)
- **`list_backups()`**: List available backups via volman
- **`setup_emergency_restart()`**: Set up trap for service recovery on interruption
- **`mark_services_stopped()` / `mark_services_running()`**: Track service state

#### File Operations
- **`atomic_write()`**: Atomic file writes (write to .tmp then move)
- **`cleanup_old_logs()`**: Keep only N most recent log files
- **`get_deployed_version()` / `save_deployed_version()`**: Manage .deployed-version file
- **`get_previous_version()` / `save_previous_version()`**: Manage .previous-version file
- **`get_backup_reference()` / `save_backup_reference()`**: Manage .pre-upgrade-backup file

#### Git Helpers
- **`get_git_commit()`**: Get current commit hash
- **`get_git_branch()`**: Get current branch name
- **`is_detached_head()`**: Check if in detached HEAD state

### Refactored Scripts

All four scripts (`backup.sh`, `restore.sh`, `deploy.sh`, `rollback.sh`) were refactored to:

1. **Source docker-helper.sh** at the beginning
2. **Replace all `docker compose` commands** with `dc_run()` calls (17 replacements total)
3. **Remove duplicate function definitions** (log, confirm, notify, etc.)
4. **Use shared validation functions** instead of inline validation code
5. **Standardize on integer boolean flags** instead of string booleans
6. **Use consistent variable names** (SKIP_CONFIRM → YES_FLAG, TELEGRAM_TOKEN → TELEGRAM_BOT_TOKEN)
7. **Leverage atomic file operations** for all version/backup reference writes

#### Code Reduction
- **backup.sh**: Reduced by ~60 lines
- **restore.sh**: Reduced by ~61 lines
- **deploy.sh**: Reduced by ~113 lines (31% reduction)
- **rollback.sh**: Reduced by ~100+ lines
- **Total**: ~334+ lines of duplicate code eliminated

### Variable Standardization

#### Boolean Flags (now integers)
- `QUIET`: `false/true` → `0/1`
- `SKIP_CONFIRM` → `YES_FLAG`: `false/true` → `0/1`
- `SKIP_LOCK`: `false/true` → `0/1`
- `STOP_SERVICES`: `false/true` → `0/1`
- `START_SERVICES`: `false/true` → `0/1`
- `FORCE_DEPLOY`: `false/true` → `0/1`
- `SKIP_BACKUP`: `false/true` → `0/1`
- `LIST_BACKUPS`: `false/true` → `0/1`

#### Variable Renames
- `TELEGRAM_TOKEN` → `TELEGRAM_BOT_TOKEN` (for consistency)
- `SKIP_CONFIRM` → `YES_FLAG` (more descriptive)

### Compatibility Improvements

#### Version Detection
The helper now detects and uses the correct docker-compose command:
- **v1.27.4 and earlier**: Uses `docker-compose` (with dash)
- **v2.0+**: Uses `docker compose` (plugin)

#### Dependency Checks
Added explicit checks for critical dependencies:
- **jq**: Required for JSON parsing (health checks, service status)
- **flock**: Required for deployment locking
- **curl**: Optional for Telegram notifications
- Provides installation instructions on failure

#### Cross-Platform Compatibility
- **Log cleanup**: Changed from GNU-specific `find -printf` to portable `ls -t` for BSD/macOS compatibility
- **Health checks**: Uses NDJSON parsing with `jq -rs` for robust JSON handling
- **Atomic writes**: Consistent pattern across all file operations

### System Requirements

Documented minimum requirements:
- **Bash 3.0+** (for `set -euo pipefail`, `BASH_SOURCE`, regex matching)
- **Git 1.8.5+** (for `^{commit}` syntax in rollback.sh)
- **jq** (for health checks and service status)
- **flock** (for deployment locking)
- **curl** (for notifications, optional)

## Testing

All refactored scripts pass syntax validation:
```bash
bash -n scripts/*.sh
```

## Migration Notes

### For Existing Installations

No changes required for existing installations. The scripts will automatically detect the available docker-compose command and use the appropriate version.

### For New Features

When adding new scripts or features:
1. Source `docker-helper.sh` at the beginning
2. Use `dc_run` instead of `docker compose` or `docker-compose`
3. Use provided helper functions instead of duplicating code
4. Use integer flags (0/1) instead of boolean strings (false/true)
5. Follow the variable naming conventions (YES_FLAG, etc.)

## Security Improvements

- **Input validation**: Centralized validation prevents injection attacks
- **Path traversal prevention**: Backup names validated to prevent `../` attacks
- **Image tag validation**: Strict regex prevents malicious tag injection
- **Atomic writes**: All critical file writes use atomic operations

## Future Enhancements

Potential improvements identified during refactoring:
1. Add version-aware JSON parsing wrapper for older docker-compose versions
2. Consider adding macOS-specific installation instructions for GNU utilities
3. Add comprehensive integration test suite
4. Consider adding `--dry-run` flag for all scripts

## References

- Original issue: docker-compose version incompatibility on production (v1.27.4)
- Related files: All scripts in `scripts/` directory
- Documentation: See individual script headers for usage
