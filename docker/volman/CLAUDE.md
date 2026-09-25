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
| `mongo.archive.gz` | MongoDB | HIGH | Historical device data (a `mongodump`, made by `backup.sh`, not a tar) | Loss of historical trends |
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
  - VOLUMES=ha influxdb  # Space-separated list
volumes:
  - ${HOMEASSISTANT_DATA_PATH}:/volumes/ha      # ✓ Matches 'ha'
  - ${DATA_PATH}/influxdb:/volumes/influxdb     # ✓ Matches 'influxdb'
```

### Backup Format

Backups are stored in timestamped directories:
```
${BACKUP_PATH}/
├── 2026_01_18_14_30_00/
│   ├── COMPLETE             # Manifest, written last (see below)
│   ├── ha.tar               # Home Assistant config
│   ├── mongo.archive.gz     # MongoDB mongodump (streamed in by `volman store`)
│   ├── influxdb.tar         # InfluxDB time-series
│   ├── grafana.tar          # Grafana dashboards
│   ├── z2m-home1.tar        # Zigbee2MQTT devices
│   ├── wireguard.tar        # VPN configs
│   └── automations-state.tar # Bot state
└── 2026_01_18_10_00_00/
    └── ...
```

### Expected Backup Sizes

Measured on routy on 2026-09-09 (backup `2026_09_09_06_44_27`):

- **Whole backup**: about **100 GiB**, taking about **62 minutes**. It is almost all InfluxDB, and it grows with InfluxDB's retention (#1371).
- **Individual volumes**:
  - `influxdb`: **99.5 GiB** (106,799,616,000 bytes; the live directory is about 83 GiB on disk), about 60 minutes to tar
  - `ha`: ~600 MiB (630,056,960 bytes)
  - `mongo.archive.gz`: compressed dump of the app database (the old `mongo.tar` was ~1.35 GiB)
  - `grafana`: ~40 MiB
  - `z2m-home1`: <1 MiB
  - `wireguard`: <1 MiB
  - `automations-state`: <1 MiB

Budget disk for backups accordingly: each kept backup costs about 100 GiB.

Checking the size by hand: the InfluxDB files belong to the container's user, so a plain `du -sh data/influxdb` as the login user shows only what it can read (a few MB) while permission errors scroll past. Use `sudo du -sh`.

### Completeness Marker

`volman backup` writes only the `.tar` files. `backup.sh` adds the Mongo dump and then runs `volman seal <name> stopped|running mongo.archive.gz`, which writes `COMPLETE`: one `file=<name>\t<bytes>\t<time>` line per file, `sealed_at=` and `services=stopped|running`. `seal` refuses a backup that lacks any volume in `VOLUMES` or any file named after the mode (here the Mongo dump).

`volman restore` refuses, **before extracting anything**, a backup without `COMPLETE` or one whose manifest does not list a volume it is asked to restore, and names the missing volumes. It warns when the backup was taken with the services running. `volman list` shows `complete` or `INCOMPLETE` and the number of volume archives for each backup. Backups made before the marker existed are all refused.

## Usage

### Create Backup

**Standard backup** (services running):
```bash
./scripts/backup.sh
# Creates timestamped backup: backup/YYYY_MM_DD_HH_MM_SS/
```

**Safe backup** (stops services first, recommended; the stack is down for about an hour):
```bash
./scripts/backup.sh -s -y
# -s: Stop services before backup; fails if a container is still running
#     after the stop, or starts while the files are copied
# -y: Auto-confirm (no prompt)
```

Deploys do not use volman any more: they take a ZFS snapshot instead (see `docs/DEPLOYMENT.md`).

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
     - VOLUMES=ha influxdb new-volume
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
  - MongoDB: restore `mongo.archive.gz` with `mongorestore` (see docs/DEPLOYMENT.md)
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

# Alert if backup size exceeds threshold (a normal backup is ~100 GiB)
BACKUP_SIZE=$(du -sm backup/latest | cut -f1)
if [ $BACKUP_SIZE -gt 150000 ]; then
  echo "WARNING: Backup size ${BACKUP_SIZE}MB exceeds 150 GB threshold"
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
- [x] Completeness marker (`seal`), checked by `restore` (#1590)
- [ ] Backup verification tests (a restore actually exercised)
- [ ] Restore dry-run mode
- [ ] Prometheus metrics for backup monitoring
