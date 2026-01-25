# Volman - Volume Backup and Restore Service

## Overview

Volman is a lightweight backup and restore service for Docker volumes. It creates TAR archives of critical persistent data volumes and enables point-in-time restoration.

## Architecture

### Design Principles
- **Configuration-driven**: Volume list defined via `VOLUMES` environment variable
- **Stateless**: No persistent state, operates on-demand via `docker compose run`
- **Isolated**: Uses `network_mode: none` and `restart: 'no'` for security
- **Flexible**: Supports arbitrary volume lists without code changes

### Current Backup Coverage (7 volumes)

| Volume | Source | Priority | Contents | Recovery Impact |
|--------|--------|----------|----------|-----------------|
| `ha` | Home Assistant | HIGH | Config, entity registry, history DB | Must reconfigure all integrations |
| `mongo` | MongoDB | HIGH | Historical device data | Loss of historical trends |
| `influxdb` | InfluxDB | HIGH | Time-series sensor data | Loss of all metrics history |
| `grafana` | Grafana | HIGH | Dashboards, alerts, users | Must recreate all dashboards |
| `z2m-home1` | Zigbee2MQTT | HIGH | Device database, network state | Must re-pair all Zigbee devices |
| `wireguard` | WireGuard VPN | HIGH | Peer configurations | Must regenerate all VPN keys |
| `automations-state` | Automation bots | MEDIUM | Bot memory/state | Auto-rebuilds from MQTT |

## Implementation

### Volume Naming Convention

Volume names in `VOLUMES` environment variable **must match** the mount point basename:

```yaml
environment:
  - VOLUMES=ha mongo influxdb  # Space-separated list
volumes:
  - ${HOMEASSISTANT_DATA_PATH}:/volumes/ha      # ✓ Matches 'ha'
  - ${MONGO_DATA_PATH}:/volumes/mongo           # ✓ Matches 'mongo'
  - ${DATA_PATH}/influxdb:/volumes/influxdb     # ✓ Matches 'influxdb'
```

### Backup Format

Backups are stored in timestamped directories:
```
${BACKUP_PATH}/
├── 2026_01_18_14_30_00/
│   ├── ha.tar               # Home Assistant config
│   ├── mongo.tar            # MongoDB data
│   ├── influxdb.tar         # InfluxDB time-series
│   ├── grafana.tar          # Grafana dashboards
│   ├── z2m-home1.tar        # Zigbee2MQTT devices
│   ├── wireguard.tar        # VPN configs
│   └── automations-state.tar # Bot state
└── 2026_01_18_10_00_00/
    └── ...
```

### Expected Backup Sizes

- **Typical backup**: 900 MB - 2.5 GB (depends on InfluxDB retention)
- **Individual volumes**:
  - `ha`: ~50-200 MB (config + entity registry + history)
  - `mongo`: ~100-500 MB (historical device data)
  - `influxdb`: ~500-2000 MB (time-series data, varies by retention)
  - `grafana`: ~5-20 MB (dashboards, alerts, users)
  - `z2m-home1`: ~1-5 MB (device database, network state)
  - `wireguard`: <1 MB (peer configs)
  - `automations-state`: ~1-10 MB (bot state files)

## Usage

### Create Backup

**Standard backup** (services running):
```bash
./scripts/backup.sh
# Creates timestamped backup: backup/YYYY_MM_DD_HH_MM_SS/
```

**Safe backup** (stops services first, recommended):
```bash
./scripts/backup.sh -s -y
# -s: Stop services before backup
# -y: Auto-confirm (no prompt)
```

**Named backup**:
```bash
./scripts/backup.sh my-backup-name
# Creates: backup/my-backup-name/
```

### Restore from Backup

**CRITICAL**: Services **must be stopped** before restore to prevent data corruption.

```bash
# Stop all services
docker compose down

# Restore from timestamped backup
./scripts/restore.sh 2026_01_18_14_30_00

# Or restore from named backup
./scripts/restore.sh my-backup-name

# Restart services
docker compose up -d
```

### Verify Backup Integrity

```bash
# List backups
ls -lh backup/

# Check tar file integrity
for f in backup/2026_01_18_14_30_00/*.tar; do
  tar -tf "$f" > /dev/null && echo "✓ $f" || echo "✗ $f FAILED"
done

# Inspect backup contents
tar -tvf backup/2026_01_18_14_30_00/ha.tar | head -20
```

## Testing

### Adding New Volumes to Backup

When adding a new volume:

1. **Update docker-compose.yml**:
   ```yaml
   environment:
     - VOLUMES=ha mongo influxdb new-volume
   volumes:
     - ${NEW_VOLUME_PATH}:/volumes/new-volume
   ```

2. **Validate configuration**:
   ```bash
   docker compose config > /dev/null
   ```

3. **Test backup**:
   ```bash
   ./scripts/backup.sh test-new-volume -s -y
   ls -lh backup/test-new-volume/
   # Verify new-volume.tar exists
   ```

4. **Test restore**:
   ```bash
   docker compose down
   ./scripts/restore.sh test-new-volume
   docker compose up -d
   # Verify service recovers data correctly
   ```

### Validation Checklist

- [ ] Volume name matches between `VOLUMES` env var and mount path
- [ ] Environment variable used in mount path exists in `example.env`
- [ ] Backup creates `.tar` file for new volume
- [ ] TAR file validates with `tar -tf`
- [ ] Restore operation succeeds
- [ ] Service starts correctly after restore
- [ ] Service recovers data (check logs, UI, functionality)

## Troubleshooting

### Backup Issues

**Backup fails with "volume not found"**:
- Verify volume name in `VOLUMES` matches mount point basename exactly
- Check mount path uses correct environment variable
- Ensure source directory exists and is readable

**TAR file is empty or corrupt**:
- Verify source volume contains data: `ls -lh ${SOURCE_PATH}`
- Check Docker volume mount permissions
- Review volman logs: `docker compose logs volman`

### Restore Issues

**Restore fails with "cannot overwrite"**:
- Ensure services are stopped: `docker compose down`
- Verify backup directory exists and contains all required `.tar` files
- Check file permissions on target volumes

**Service fails to start after restore**:
- Check service logs: `docker compose logs service-name`
- Verify restored data integrity: `ls -lh ${VOLUME_PATH}`
- Common issues:
  - MongoDB: May need to repair: `docker compose run mongo mongod --repair`
  - InfluxDB: Check data directory ownership matches container UID
  - Grafana: Verify database file permissions

## Maintenance

### Backup Rotation

Volman does not automatically delete old backups. Implement rotation via cron:

```bash
# Keep last 7 daily backups
find ${BACKUP_PATH} -maxdepth 1 -type d -mtime +7 -exec rm -rf {} \;
```

### Monitoring Backup Size

```bash
# Check total backup storage
du -sh backup/

# Check individual backup sizes
du -sh backup/*/ | sort -h

# Alert if backup size exceeds threshold
BACKUP_SIZE=$(du -sm backup/latest | cut -f1)
if [ $BACKUP_SIZE -gt 3000 ]; then
  echo "WARNING: Backup size ${BACKUP_SIZE}MB exceeds 3GB threshold"
fi
```

## Security Considerations

- **No network access**: Service runs with `network_mode: none`
- **No privilege escalation**: Uses `no-new-privileges:true`
- **No automatic execution**: Runs only via `docker compose run` (not `up`)
- **Backup encryption**: Not implemented; backups are unencrypted TAR archives
- **Secrets in backups**: Yes, backups include credentials (encrypt at rest recommended)

## Future Enhancements

- [ ] Automated backup rotation/cleanup
- [ ] Backup encryption (GPG or age)
- [ ] Remote backup upload (S3, rsync)
- [ ] Incremental backups (rsync, restic)
- [ ] Backup verification tests
- [ ] Restore dry-run mode
- [ ] Prometheus metrics for backup monitoring
