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
│    2. Stop services and backup databases                         │
│    3. Pull new images from GHCR                                  │
│    4. Start services                                             │
│    5. Verify health                                              │
│    6. On failure → automatic rollback                            │
└─────────────────────────────────────────────────────────────────┘
```

## Deployment Workflows

### Standard Deployment

Deploy the latest version from master:

```bash
ssh production
cd /path/to/homy
./scripts/deploy.sh
```

The script will:
1. Fetch the latest code from origin/master
2. Stop all services
3. Create a backup of databases (InfluxDB, MongoDB, Home Assistant)
4. Pull prebuilt images from GHCR
5. Start services with new images
6. Wait for health checks to pass
7. If unhealthy after 5 minutes, automatically rollback

### Force Redeploy

Redeploy the current version (e.g., after configuration changes):

```bash
./scripts/deploy.sh --force
```

### Deploy Specific Version

Deploy a specific git SHA or tag:

```bash
IMAGE_TAG=abc1234 ./scripts/deploy.sh --force
```

### Rollback

#### Automatic Rollback

The deploy script automatically rolls back if services are unhealthy after deployment.

#### Manual Rollback

Use the most recent pre-upgrade backup:

```bash
./scripts/rollback.sh
```

Rollback to a specific backup:

```bash
./scripts/rollback.sh 2026_01_17_14_30
```

List available backups:

```bash
./scripts/rollback.sh --list
```

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
# Use latest for development
IMAGE_TAG=latest

# Or pin to specific version for production
IMAGE_TAG=abc1234567890
```

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

List and verify backups:

```bash
docker compose run --rm volman list
```

Manual backup:

```bash
docker compose run --rm volman backup
```

Manual restore (stops services first):

```bash
docker compose down
docker compose run --rm volman restore BACKUP_NAME
docker compose up -d
```

## Pre-Deployment Checklist

Before deploying to production:

1. [ ] All tests pass in CI
2. [ ] App images built and pushed to GHCR
3. [ ] GHCR authentication configured on production server
4. [ ] Sufficient disk space for backup
5. [ ] Telegram notifications configured (optional)
6. [ ] No critical processes running that require uninterrupted service

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
