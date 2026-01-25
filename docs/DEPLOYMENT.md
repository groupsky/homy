# Production Deployment Guide

This document describes the deployment strategy for the homy home automation system, including prebuilt images, deployment procedures, and rollback capabilities.

## Overview

The deployment system uses prebuilt Docker images stored in GitHub Container Registry (GHCR) to enable fast, reliable production deployments with database-aware rollback capability.

### Key Benefits

- **Fast deployments**: No building on production servers
- **Consistent images**: Same image tested in CI runs in production
- **Version tracking**: Git SHA-based versioning for easy correlation
- **Safe rollback**: Database backups before each upgrade enable full rollback

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         GitHub Actions                           │
├─────────────────────────────────────────────────────────────────┤
│  PR/Push → Tests → Build Images → Push to GHCR (on master)      │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                    GHCR (ghcr.io/groupsky/homy)                  │
├─────────────────────────────────────────────────────────────────┤
│  App Images:  automations:sha-abc123, mqtt-influx:latest, etc.  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Production Server                           │
├─────────────────────────────────────────────────────────────────┤
│  ./scripts/deploy.sh                                             │
│    1. Record current version                                     │
│    2. Pull new images from GHCR                                  │
│    3. Stop services and backup databases                         │
│    4. Start services                                             │
│    5. Verify health                                              │
│    6. On failure → automatic rollback                            │
└─────────────────────────────────────────────────────────────────┘
```

## Scripts Reference

All scripts are located in the `scripts/` directory and support `-h/--help` for usage information.

### deploy.sh

Deploy the system with prebuilt images from GHCR.

```
Usage: deploy.sh [OPTIONS]

Options:
  -h, --help          Show help message
  -t, --tag TAG       Deploy specific image tag (git SHA, branch name, or 'latest')
  -f, --force         Force redeploy even if already at target version
  -y, --yes           Skip confirmation prompt
  --skip-backup       Skip database backup (DANGEROUS - use only in emergencies)
```

**Examples:**
```bash
./scripts/deploy.sh                      # Deploy latest from master
./scripts/deploy.sh --tag abc1234        # Deploy specific git SHA
./scripts/deploy.sh --tag feature-x      # Deploy from branch
./scripts/deploy.sh --tag latest -f      # Force redeploy latest
./scripts/deploy.sh -t abc1234 -y        # Deploy without confirmation
./scripts/deploy.sh --skip-backup        # Emergency deploy without backup (requires confirmation)
```

**Emergency Deployment (--skip-backup):**

The `--skip-backup` option allows deployment without creating a database backup. This should **only** be used in emergencies where:
- Backup creation is failing and blocking deployments
- Immediate deployment is critical and data loss risk is acceptable
- You have verified backups exist from a previous deployment

When using `--skip-backup`, you must type `yes-skip-backup` to confirm you understand the risks:
- If deployment fails, automatic rollback will not be possible
- You may lose data if something goes wrong
- Manual recovery will be required in case of failure

Services are still stopped cleanly before deployment even when skipping backup.

### rollback.sh

Rollback to a previous version with database restoration.

```
Usage: rollback.sh [OPTIONS] [BACKUP_NAME]

Options:
  -h, --help          Show help message
  -l, --list          List available backups
  -y, --yes           Skip confirmation prompt
```

**Examples:**
```bash
./scripts/rollback.sh                        # Rollback to most recent backup
./scripts/rollback.sh 2026_01_17_14_30_00    # Rollback to specific backup
./scripts/rollback.sh --list                 # List available backups
./scripts/rollback.sh -y                     # Rollback without confirmation
```

### backup.sh

Create a manual backup of all databases.

```
Usage: backup.sh [OPTIONS] [BACKUP_NAME]

Options:
  -h, --help          Show help message
  -s, --stop          Stop services before backup (recommended for consistency)
  -y, --yes           Skip confirmation prompt
  -q, --quiet         Quiet mode - output only backup name (for scripting)
```

**Examples:**
```bash
./scripts/backup.sh                      # Interactive backup with timestamp name
./scripts/backup.sh pre-upgrade          # Create backup named 'pre-upgrade'
./scripts/backup.sh -s                   # Stop services for consistent backup
./scripts/backup.sh -s -y                # Stop services, no confirmation
./scripts/backup.sh -q                   # Quiet mode for scripts
```

### restore.sh

Restore databases from a backup.

```
Usage: restore.sh [OPTIONS] [BACKUP_NAME]

Options:
  -h, --help          Show help message
  -l, --list          List available backups
  -s, --start         Start services after restore
  -y, --yes           Skip confirmation prompt
  -q, --quiet         Quiet mode (for scripting)
```

**Examples:**
```bash
./scripts/restore.sh --list                  # List available backups
./scripts/restore.sh 2026_01_17_14_30_00     # Restore specific backup
./scripts/restore.sh                         # Restore most recent backup
./scripts/restore.sh -s -y                   # Restore and start services
```

**Note:** Services must be stopped before restore. Use `docker compose stop` first, or use `rollback.sh` which handles this automatically.

## Deployment Workflows

### Standard Deployment

Deploy the latest version from master:

```bash
ssh production
cd /path/to/homy
./scripts/deploy.sh
```

The script will:
1. Show deployment plan and ask for confirmation
2. Pull prebuilt images from GHCR (while services are still running)
3. Stop all services (using `docker compose stop` to preserve container state)
4. Create a backup of databases (InfluxDB, MongoDB, Home Assistant)
5. Start services with new images
6. Wait for health checks to pass (5 minutes timeout)
7. If successful, save current version to `.previous-version` for easy rollback
8. If unhealthy, automatically rollback to previous version

### Deploy Specific Version

Deploy a specific git SHA or branch:

```bash
./scripts/deploy.sh --tag abc1234        # Specific SHA
./scripts/deploy.sh --tag feature-branch # Branch name
./scripts/deploy.sh --tag latest         # Latest from master
```

### Force Redeploy

Redeploy the current version (e.g., after configuration changes):

```bash
./scripts/deploy.sh --force
./scripts/deploy.sh -t abc1234 -f        # Force specific version
```

### Rollback

#### Automatic Rollback

The deploy script automatically rolls back if services are unhealthy after deployment.

#### Manual Rollback

Use the most recent pre-upgrade backup:

```bash
./scripts/rollback.sh
```

The rollback script automatically:
- Restores databases from the most recent backup
- Rolls back to the previous version (saved in `.previous-version` file during deployment)
- Falls back to git history calculation if version file doesn't exist

Rollback to a specific backup:

```bash
./scripts/rollback.sh 2026_01_17_14_30_00
```

List available backups:

```bash
./scripts/rollback.sh --list
```

### Manual Backup and Restore

For maintenance or migration, you can backup and restore independently:

```bash
# Create a backup before maintenance
./scripts/backup.sh -s maintenance-backup

# ... perform maintenance ...

# Restore if needed
docker compose stop
./scripts/restore.sh -s maintenance-backup
```

**Note:** The backup script uses `docker compose stop` instead of `docker compose down` to preserve container state and networks, allowing for faster restart with `docker compose start`.

## Image Management

### Built Images

The following services are built as prebuilt images in CI:

| Service | Description |
|---------|-------------|
| automations | Core automation engine |
| automation-events-processor | Automation event processing |
| dmx-driver | DMX lighting control |
| grafana | Metrics visualization |
| historian | Historical data processing |
| homeassistant | Home Assistant integration |
| influxdb | Time-series database |
| modbus-serial | Modbus device communication |
| mosquitto | MQTT broker |
| mqtt-influx | MQTT to InfluxDB bridge |
| mqtt-mongo | MQTT to MongoDB bridge |
| sunseeker-monitoring | Lawn mower monitoring |
| telegram-bridge | Telegram notifications |
| volman | Volume backup management |
| zigbee2mqtt | Zigbee device integration |

### Image Tags

Each push to master creates images with multiple tags:

- `ghcr.io/groupsky/homy/SERVICE:FULL_SHA` - Full git commit SHA
- `ghcr.io/groupsky/homy/SERVICE:SHORT_SHA` - First 7 characters of SHA
- `ghcr.io/groupsky/homy/SERVICE:latest` - Most recent build

### Manual Image Pull

To manually pull a specific version:

```bash
IMAGE_TAG=abc1234 docker compose pull automations mqtt-influx
```

## Database Rollback Strategy

### Understanding Data Loss on Rollback

When rolling back:
1. **Code rollback** is straightforward - use older image
2. **Database rollback** restores from pre-upgrade backup

**This means any data written after the upgrade will be lost.**

### Database Types and Impact

| Database | Type | Rollback Impact | Notes |
|----------|------|-----------------|-------|
| InfluxDB | Time-series | Lose sensor readings since upgrade | Sensors will refill data |
| MongoDB | Document | Lose historical records | Non-critical for operation |
| HA SQLite | Config/state | Lose state changes | Automations reset cleanly |

### When Rollback is Acceptable

Rollback is designed for emergency situations where:
- Services are broken and unrecoverable
- A critical bug was introduced
- System stability is more important than recent data

For most home automation use cases, losing a few hours of sensor data is acceptable to restore system functionality.

## Configuration

### Environment Variables

Set in your `.env` file:

```bash
# Use latest for development (default)
IMAGE_TAG=latest

# Or pin to specific git SHA for production
IMAGE_TAG=abc1234567890123456789012345678901234abcd

# Short SHA also works
IMAGE_TAG=abc1234
```

**Note:** The CI workflow creates SHA-based tags only (full SHA, short SHA, and `latest`). Semantic version tags (v1.2.3) are not automatically created.

### Docker Compose Dual-Mode

The docker-compose.yml supports both modes:

- **Development**: `docker compose build` uses local Dockerfile
- **Production**: `docker compose pull` uses prebuilt GHCR images

```yaml
services:
  automations:
    image: ghcr.io/groupsky/homy/automations:${IMAGE_TAG:-latest}
    build: docker/automations
```

## Troubleshooting

### Deployment Logs

Deployment logs are stored in `logs/deploy-*.log`:

```bash
# View most recent deployment log
ls -lt logs/deploy-*.log | head -1 | xargs cat
```

### Health Check Failures

If deployment fails due to health check:

1. Check service logs:
   ```bash
   docker compose logs automations mqtt-influx
   ```

2. Check container status:
   ```bash
   docker compose ps
   ```

3. Review the deployment log for specific errors

### Image Pull Failures

If GHCR pull fails:

1. Verify GHCR authentication:
   ```bash
   docker login ghcr.io
   ```

2. Check if the image exists:
   ```bash
   docker manifest inspect ghcr.io/groupsky/homy/automations:latest
   ```

3. Fall back to local build:
   ```bash
   docker compose build automations
   docker compose up -d automations
   ```

### Backup Issues

List available backups:

```bash
./scripts/backup.sh --list
# or
./scripts/restore.sh --list
```

Create a manual backup:

```bash
./scripts/backup.sh                      # Interactive
./scripts/backup.sh -s pre-maintenance   # Stop services, named backup
```

Restore from backup:

```bash
docker compose stop
./scripts/restore.sh -s BACKUP_NAME      # Restore and start services
```

Direct volman commands (advanced):

```bash
docker compose run --rm volman list
docker compose run --rm volman backup
docker compose run --rm volman restore BACKUP_NAME
```

## Prerequisites

The following tools must be installed on the production server:

| Tool | Purpose | Installation |
|------|---------|--------------|
| docker | Container runtime | https://docs.docker.com/engine/install/ |
| docker compose | Container orchestration | Included with Docker Desktop or install plugin |
| git | Version control | `apt install git` |
| jq | JSON processing for health checks | `apt install jq` |
| curl | API requests (notifications) | `apt install curl` |

## Pre-Deployment Checklist

Before deploying to production:

1. [ ] All tests pass in CI
2. [ ] App images built and pushed to GHCR
3. [ ] GHCR authentication configured on production server
4. [ ] All prerequisites installed (docker, jq, git, curl)
5. [ ] Sufficient disk space for backup
6. [ ] Telegram notifications configured (optional)
7. [ ] No critical processes running that require uninterrupted service

## Post-Deployment Verification

After successful deployment:

1. Check Grafana dashboards for data continuity
2. Verify Home Assistant entities are responding
3. Confirm MQTT messages are flowing
4. Check Telegram for successful deployment notification

## Notifications

The deployment scripts send Telegram notifications for:

- Successful deployments
- Deployment failures
- Rollback completion

Configure by creating the secrets:

```bash
echo "your-bot-token" > secrets/telegram_bot_token
echo "your-chat-id" > secrets/telegram_chat_id
```
