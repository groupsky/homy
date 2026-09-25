# Production Deployment Guide

This document describes the deployment strategy for the homy home automation system, including prebuilt images, deployment procedures, and rollback capabilities.

## Overview

The deployment system uses prebuilt Docker images stored in GitHub Container Registry (GHCR). A deploy does not stop the stack: it takes a ZFS snapshot of the data, recreates only the services whose image or configuration changed, and checks those services before it reports success. A normal deploy takes one to two minutes.

### Key Benefits

- **Fast deployments**: No building on production servers, no backup copy, and unchanged services keep running
- **Consistent images**: Same image tested in CI runs in production
- **Version tracking**: Git SHA-based versioning for easy correlation
- **Safe rollback**: A failed deploy rolls code, config and images back without losing data; the snapshot allows a manual data restore

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
│  ./scripts/deploy.sh          (the stack keeps running)          │
│    1. ZFS snapshot of all data (about a second)                  │
│    2. Update code, pull new images                               │
│    3. Pin images by digest, hash mounted config files            │
│    4. docker compose up: only changed services are recreated    │
│    5. Health gate on the recreated services                      │
│    6. On failure → roll code, config and images back (no data)   │
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
  --skip-snapshot     Deploy without the pre-deploy ZFS snapshot (DANGEROUS)
  --skip-backup       Old name of --skip-snapshot
```

**Examples:**
```bash
./scripts/deploy.sh                      # Deploy latest from master
./scripts/deploy.sh --tag abc1234        # Deploy specific git SHA
./scripts/deploy.sh --tag feature-x      # Deploy from branch
./scripts/deploy.sh --tag latest -f      # Force redeploy latest
./scripts/deploy.sh -t abc1234 -y        # Deploy without confirmation
./scripts/deploy.sh --skip-snapshot      # Deploy without a snapshot (requires confirmation)
```

**Deploying without a snapshot (`--skip-snapshot`):**

Use it only on a host whose data is not on ZFS, or when the snapshot step itself is broken and the deploy cannot wait. You must type `yes-skip-snapshot` (unless `--yes` is given). Without a snapshot, a stateful service that breaks during the deploy cannot have its data restored from this deploy. `--skip-backup` is the old name of the same option; it does **not** stop the stack or run `docker compose down`.

### snapshot.sh

Takes the pre-deploy snapshot; `deploy.sh` calls it. Run it by hand with `--check` to see whether a host is ready:

```bash
./scripts/snapshot.sh --check            # checks everything, takes no snapshot
```

See [The pre-deploy snapshot](#the-pre-deploy-snapshot).

### restore-snapshot.sh

Copies the data directories of chosen services back from a deploy snapshot. Manual only; see [Restoring data from a deploy snapshot](#restoring-data-from-a-deploy-snapshot).

```
Usage: restore-snapshot.sh [OPTIONS] SERVICE...

Options:
  -h, --help          Show help message
  -l, --list          List the deploy snapshots
  --snapshot NAME     Snapshot to restore from (default: the last deploy's)
  --no-start          Leave the services stopped afterwards
  -y, --yes           Do not ask for confirmation
```

### rollback.sh

Rollback to a previous version with database restoration from a **volman backup** (not a snapshot). It stops the whole stack and throws away everything written since that backup. `deploy.sh` does not call it.

```
Usage: rollback.sh [OPTIONS] BACKUP_NAME

Options:
  -h, --help          Show help message
  -l, --list          List available backups
  -y, --yes           Skip confirmation prompt
  --no-lock           Do not take the deployment lock (only when the caller holds it)
```

The backup name is **required**. `.pre-upgrade-backup` can be weeks older than the version in `.previous-version`, and restoring it would throw away everything since (InfluxDB alone is about 100 GB). Check the date with `--list` first.

**Examples:**
```bash
./scripts/rollback.sh --list                 # List available backups
./scripts/rollback.sh 2026_01_17_14_30_00    # Rollback to a specific backup
./scripts/rollback.sh -y 2026_01_17_14_30_00 # ...without confirmation
```

If the restore fails, it `start`s the existing (stopped) containers again rather than recreating them; the previous version is started with `up -d --no-build --pull never`, and the deploy override (whose pins point at the version being rolled back from) is deleted.

### backup.sh

Create an off-host-style backup (tar archives) of the stack's volumes and a MongoDB dump. It is for scheduled and manual backups; **deploys no longer use it**.

```
Usage: backup.sh [OPTIONS] [BACKUP_NAME]

Options:
  -h, --help          Show help message
  -s, --stop          Stop services before backup (recommended for consistency)
  -y, --yes           Skip confirmation prompt
  -q, --quiet         Quiet mode - output only backup name (for scripting)
  --no-lock           Do not take the deployment lock (only when the caller holds it)
```

**Examples:**
```bash
./scripts/backup.sh                      # Interactive backup with timestamp name
./scripts/backup.sh -s                   # Stop services for consistent backup
./scripts/backup.sh -s -y                # Stop services, no confirmation
./scripts/backup.sh -q                   # Quiet mode for scripts
```

**What it costs.** Measured on routy on 2026-09-09: the `influxdb` archive alone is **99.5 GiB** and takes about **60 minutes**; the whole backup about 62 minutes. With `--stop` the stack is down for all of that time.

**`--stop` is checked, not assumed** (#1589). After stopping, `backup.sh` checks that no container of the stack is running, and after the copy it checks that none was started meanwhile (a cron job or a restart policy can start one). If either check fails, the backup stops with an error and the backup is left without its completeness marker.

**Completeness marker** (#1590). Only when every volume archive and the MongoDB dump are written does `backup.sh` run `volman seal`, which writes a `COMPLETE` manifest (file names, sizes, times, and whether the services were stopped). `restore.sh` refuses, before extracting anything, a backup without `COMPLETE` or missing a volume, and names what is missing. `volman list` shows `complete` or `INCOMPLETE` for each backup. `backup.sh` also names the Mongo dump as required, so `seal` refuses a backup without `mongo.archive.gz`.

Backups made before 2026-09-25 have no marker, so `restore.sh` refuses them all. They are left that way on purpose. To make one restorable, first check it by hand: every volume archive is there and lists cleanly (`tar tf <file> > /dev/null`), and ideally a throwaway InfluxDB started on a scratch copy answers a query. Then seal it, saying it was taken with the services running (these were, see #1589):

```bash
docker compose run --rm volman seal <backup name> running
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

**Note:** Services must be stopped before restore. Use `docker compose stop` first, or use `rollback.sh` which handles this automatically. `-s` `start`s the existing containers; it creates none, so after a `docker compose down` start them with `docker compose -f docker-compose.yml -f docker-compose.deploy.yml up -d` instead.

## Deployment Workflows

### Standard Deployment

Deploy the latest version from master:

```bash
ssh production
cd /path/to/homy
./scripts/deploy.sh
```

The script:

1. Checks that `docker compose` v2 is installed, and stops if it is not (see [Hosts without docker compose v2](#hosts-without-docker-compose-v2)).
2. Shows the deployment plan and asks for confirmation.
3. **Takes the snapshot** (`snapshot.sh`) before anything else. If it fails, the deploy stops here: the code, the images and every container are untouched.
4. Updates the code to `origin/master` and pulls the images for that commit. If the pull fails, the code is put back and nothing is restarted.
5. Writes `docker-compose.deploy.yml` (not in git): every service pinned to its image **digest** and labelled with a hash of the host files it mounts (see [Recreating only what changed](#recreating-only-what-changed)).
6. Refuses (before restarting anything) when a service has more than one container, for example a leftover `<id>_<name>` container from an interrupted recreate: neither the change detection nor the gate could tell which one counts. Remove the leftover by hand.
7. Works out which services to recreate: those whose config hash (`docker compose config --hash`) differs from the `com.docker.compose.config-hash` label of their container, those with no container, and those whose container is stopped. It logs them and runs `docker compose up -d --no-build --pull never --no-deps` for **only those services**, under a time limit (`COMPOSE_TIMEOUT`, 600 s; a timeout is a failed `up`). If nothing changed, `up` is not run at all. Nothing is stopped first.
8. Runs the [health gate](#the-health-gate) on the services that were actually recreated, or started because they were not running. A container that restarted by itself (already running or `restarting` before) is not counted.
9. On success, saves the old version to `.previous-version` and the new one to `.deployed-version`, and sends the success message (with the recreated services and the snapshot name).
10. On failure, [rolls back](#automatic-rollback) code, config and images.

A deploy that changes nothing restarts nothing. The first deploy after this change is a special case: it moves every service from a tag to a digest, so it recreates all of them once.

### The pre-deploy snapshot

All persistent data of the stack lives in host directories (bind mounts, see [Where state lives](#where-state-lives-and-down)). When they are all on one ZFS dataset, one snapshot captures InfluxDB, Mongo, the broker, HA, zigbee2mqtt and Grafana **at the same instant**, in about a second, with the stack running.

The snapshot is **crash-consistent**, like a power cut: fine for Mongo's journal, HA's SQLite WAL and InfluxDB's WAL, but InfluxDB may need to rebuild its index after a restore. It is not a backup copy: it lives on the same pool as the data.

`snapshot.sh` finds everything at run time; nothing host-specific is in the repo:

- It reads the writable bind mounts of every long-running service from `docker compose config` (system paths such as `/dev` and `/lib/modules`, read-only config mounts and one-shot services like `volman` are left out) and asks `zfs list -H -o name <dir>` for the dataset of each.
- It **stops** when they are not all on one dataset, when a directory is not on ZFS, or when a service keeps state in a Docker volume (named, or an image `VOLUME` left unmounted), because the snapshot would miss it.
- It **refuses** when the pool has less than `SNAPSHOT_MIN_FREE_GB` (default 20) GiB free.
- It names the snapshot exactly `<dataset>@homy-deploy-<UTC yyyymmddThhmmssZ>-<short sha>`, for example `tank/homy@homy-deploy-20260925T101500Z-abc1234`, checks that it exists, and records the name in `.pre-deploy-snapshot`. The host prunes deploy snapshots by the `homy-deploy-` prefix, so keep the name exact.

The deploy user needs permission to take snapshots, and nothing more (it cannot destroy them):

```bash
sudo zfs allow <deploy user> snapshot <dataset>
```

Pruning old snapshots is done on the host, not by these scripts.

### Recreating only what changed

`IMAGE_TAG` is the commit SHA, so the image reference of every service changes on every deploy even when its image does not. Compose recreates a container when the service's config hash changes, and the image reference is part of that hash. So `deploy.sh` writes an override, `docker-compose.deploy.yml`:

- **Digest pins.** Each service's `image:` becomes `<repo>@sha256:<digest>`. CI's SHA retag copies the manifest, so an unchanged service keeps the same digest, the same config hash, and keeps running.
- **Config-file hash label.** A changed `broker.conf`, automations `config.js`, Grafana provisioning file or secret file changes no image and nothing in the compose file. Each service gets a label `homy.config-files-hash` with a hash of the contents of its read-only bind mounts (every file under a mounted directory), its secret files and its `env_file`s. Data directories (writable mounts) are left out.
- A change to `docker-compose.yml` or `.env` (environment, ports, mounts, healthchecks) changes the config hash by itself.

The time zone files (`/etc/localtime`, `/etc/timezone`, `/usr/share/zoneinfo`) are not part of the hash: they are the host's clock settings, not a service's configuration.

**Why only the changed services are passed to `up`.** Compose 2.18 (what routy runs) recreates every service that depends on a recreated one when that dependent is passed to `up`, even with `--no-deps`: with every service passed, a broker change would restart some 26 containers. So `deploy.sh` passes only the services that need it, and `--no-deps` keeps compose from touching their dependencies. When the prediction itself fails, it falls back to passing every service, and dependents may then be recreated too. `scripts/tests/compose-real.sh` checks this against a real compose 2.18.1 in CI.

`--no-build` matters: every service has a `build:` key, and without it compose would build on the host when an image is missing. `--pull never` makes compose use exactly the images just pulled.

The override stays in the project directory after the deploy. A manual `docker compose up -d` without it would see a different image reference for every service and recreate them all. To run compose by hand with the same pins:

```bash
docker compose -f docker-compose.yml -f docker-compose.deploy.yml up -d <service>
```

Do not put the override into `COMPOSE_FILE` in `.env`: `rollback.sh` deletes it (its pins point at the version being rolled back from), and the next deploy writes a new one. If the host has a `docker-compose.override.yml`, or sets `COMPOSE_FILE` in the environment or `.env`, the scripts use those files as the base.

The deploy does not pass `--remove-orphans`: a service that a new version removes from `docker-compose.yml` keeps running until it is removed by hand (`docker compose up -d --remove-orphans` with the override), and a service added by a failed version keeps running after the rollback.

### The health gate

The gate waits on the services the deploy recreated or started, not the whole stack:

- A service **with a healthcheck** passes when Docker reports it `healthy`, and fails as soon as it is `unhealthy`, exited or dead. Failures inside its start period do not count.
- A service **without a healthcheck** passes when it is running and its restart count has not changed for 30 s (`HEALTH_STABLE_SECONDS`).
- **One-shot services** (`restart: "no"`, such as `volman` and the historians) are skipped; the deploy does not start them either.
- The gate's time limit is the longest *start period + interval × retries + timeout* of the services it waits on, plus 60 s.
- When the gate **cannot check at all** (no `docker compose` v2, no `jq`, a container missing, `docker inspect` failing), it fails loudly. The deploy then reports that the check could not be done, does not report success, does not record the new version, does not roll back, and [blocks further deploys](#automatic-rollback) until someone has looked.

Healthchecks with a start period:

| Service | Where | Start period | Interval × retries |
|---|---|---|---|
| `influxdb` | `docker/influxdb/Dockerfile` | 300 s (opening the shards takes about 2 minutes) | 1 s × 3 |
| `ha` | `docker/homeassistant/Dockerfile` | 180 s | 30 s × 3 |
| `mongo` | `docker/mongo/Dockerfile` | 120 s | 30 s × 3 |
| `z2m-home1` | `docker-compose.yml` (the image cannot start without its adapter, so CI could not test it) | 120 s | 60 s × 5 |
| `broker` | `docker/mosquitto/Dockerfile` | none | 30 s × 6 |

`grafana` starts only after `influxdb` is healthy (`depends_on: condition: service_healthy`), so its alerts do not fire NoData while InfluxDB loads (#1365). This holds when the whole stack starts (after a reboot, `docker compose up -d`). A deploy passes `--no-deps`, so recreating `influxdb` does not restart `grafana`; the health gate waits for `influxdb` instead.

### Automatic rollback

When the gate fails, or `docker compose up` fails:

- **Stateless services**: `deploy.sh` checks out the previous commit (compose file and config files), pulls the previous version's images, writes a new override pinned to them, and runs `up` again. The recreated services go through the gate again. **No data is restored**: that would throw away everything written since the deploy.
- **A stateful service whose image changed** (labelled `homy.stateful: "true"`: `ha`, `z2m-home1`, `mongo`, `grafana`, `influxdb`): its data may already be migrated (HA recorder schema, zigbee2mqtt database, Mongo feature compatibility version, Grafana migrations), and the old image may not read it. The deploy **does not roll back at all**: it stops, sends a CRITICAL message with the snapshot name, and prints the recovery steps. The containers are left as they are, so a slow migration is not cut short.
- A stateful service recreated only for a configuration change is rolled back with the rest.
- The rollback target is the commit in `.deployed-version` (code, config and images of the last successful deploy). When that is not a commit SHA (for example `latest`, which may already point at the failed images), nothing is rolled back and a CRITICAL message is sent.
- **A failed service the rollback does not recreate** is still the broken container: the cause is not in the code but on the host (`.env`, a secret, config outside git). The rollback is then reported as failed (CRITICAL), not as a success. The gate after a rollback covers everything the deploy or the rollback touched.
- **A failed forced redeploy of the version already running** (`--force` with nothing new) has nothing to roll back to; it is reported as a failed rollback for the same reason.

**Blocked deploys.** When a failed deploy is not rolled back (a stateful image changed, the gate could not check, the previous version is unknown, or the rollback itself failed), `deploy.sh` writes `.deploy-blocked` with the reason, the snapshot and the recovery steps, and refuses to deploy until that file is removed. Without it, the next deploy would see nothing to recreate and report success on top of a broken service.

**Going back after a stateful block.** The printed steps are, in this order:

```bash
# 1. restore the data from before the deploy, and leave the services stopped
#    (started on the new image, they would migrate the data again)
sudo ./scripts/restore-snapshot.sh --no-start --snapshot <snapshot> <services>
# 2. the old code and config
git -c submodule.recurse=false checkout <previous sha>
git submodule update --init --recursive
# 3. allow deploys again
rm .deploy-blocked
# 4. start everything the failed deploy changed on the old images
./scripts/deploy.sh --tag <previous sha> --force
```

`--tag` does not update the code, which is why step 2 comes first. The other way out is to fix forward: remove `.deploy-blocked` and deploy a fixed version.

The rollback never rolls back the ZFS dataset: it holds more than this stack.

### Restoring data from a deploy snapshot

`restore-snapshot.sh` is manual. It needs root, because the data belongs to several service users and must keep its owners.

```bash
sudo ./scripts/restore-snapshot.sh --list                 # the deploy snapshots
sudo ./scripts/restore-snapshot.sh ha                     # from the last deploy's snapshot
sudo ./scripts/restore-snapshot.sh --snapshot tank/homy@homy-deploy-20260925T101500Z-abc1234 influxdb mongo
```

It:

1. finds the data directories of the named services (their writable bind mounts) and checks that each is in the snapshot and that the copy fits in the free space;
2. shows the plan and **asks for confirmation**;
3. stops **only** the services that use those directories (for example `automations` and `boiler-controller` share one), and checks that they stopped;
4. renames each current directory to `<dir>.pre-restore-<UTC time>` (nothing is deleted) and copies the snapshot's copy from `<mountpoint>/.zfs/snapshot/<snapshot>/...` in its place;
5. starts the services again, unless `--no-start` is given. If a copy fails, it moves the current data back and leaves the services stopped.

A directory on a child dataset of the snapshot's dataset is refused: the parent's snapshot holds only an empty directory there.

Delete the `.pre-restore-` directories by hand once the services work. Everything the restored services wrote since the snapshot is replaced.

### Hosts without docker compose v2

`deploy.sh` requires the `docker compose` v2 plugin and stops before touching anything when it only finds `docker-compose` 1.x: 1.x cannot report health through `ps --format json`, and a gate that cannot check must not pass (#1545). `rollback.sh` uses the same gate, so on such a host it reports the rollback as failed instead of healthy.

### Where state lives, and `down`

Every service with state keeps it in a host directory under `${DATA_PATH}` (a bind mount), never in a Docker volume:

| Service | Host directory | Container path |
|---|---|---|
| `mongo` | `${DATA_PATH}/mongodb/db`, `${DATA_PATH}/mongodb/configdb` (owned by 999:999) | `/data/db`, `/data/configdb` |
| `broker` | `${DATA_PATH}/mosquitto/data`, `${DATA_PATH}/mosquitto/log` | `/mosquitto/data`, `/mosquitto/log` |

Why: an image that declares `VOLUME /x` gets an unnamed Docker volume unless the service mounts exactly `/x`. `docker compose up -d` keeps such a volume, but `docker compose down` does not. Until 2026-09-25 this made every `down` start MongoDB from an empty database and drop the broker's retained messages. A CI test (`scripts/compose-volumes.test.mjs`) now fails if any service has an unnamed volume, and `snapshot.sh` refuses to snapshot while a running container has one.

With the bind mounts, `docker compose down` keeps the data. **Never use `docker compose down -v`.** To stop a stateful service for a moment, prefer `docker compose stop <service>`.

### MongoDB backup and restore

`scripts/backup.sh` does not tar Mongo's files (a tar of a running `mongod` is not consistent). It runs `mongodump` and saves `mongo.archive.gz` in the backup directory. To restore, with `mongo` running (this merges the dump into the live database, it does not replace it; add `--drop` for that). `<backup dir>` is your `BACKUP_PATH` from `.env`:

```bash
docker compose exec -T mongo sh -c 'mongorestore --archive --gzip --nsInclude "$MONGO_INITDB_DATABASE.*" --authenticationDatabase admin -u "$(cat /run/secrets/mongo_root_username)" -p "$(cat /run/secrets/mongo_root_password)"' < <backup dir>/<backup>/mongo.archive.gz
```

### Deploy Specific Version

Deploy a specific git SHA or branch:

```bash
./scripts/deploy.sh --tag abc1234        # Specific SHA
./scripts/deploy.sh --tag feature-branch # Branch name
./scripts/deploy.sh --tag latest         # Latest from master
```

With `--tag`, the code is not updated: the images of that tag run with the compose file already checked out.

### Force Redeploy

Redeploy the current version (e.g., after configuration changes):

```bash
./scripts/deploy.sh --force
./scripts/deploy.sh -t abc1234 -f        # Force specific version
```

A forced redeploy recreates only the services whose configuration (or config files) changed.

### Deploys that restart a device or port holder

`influxdb`, `broker`, `z2m-home1`, `vpn` and the Modbus pollers hold host ports or USB/serial devices, so a second copy cannot run beside the old one. When their image or configuration changes, that deploy restarts them; for InfluxDB that is about 2 minutes. Such deploys are rare and should be announced.

### Manual Rollback from a volman backup

`rollback.sh` restores the databases from a volman backup and starts the previous version. It stops the whole stack and loses everything written since that backup; prefer `restore-snapshot.sh` for one service.

```bash
./scripts/rollback.sh --list                 # list backups; check the date
./scripts/rollback.sh 2026_01_17_14_30_00    # the backup to restore (required)
```

It rolls back to the version in `.previous-version`, falling back to git history when that file does not exist.

### Manual Backup and Restore

For maintenance or migration, you can backup and restore independently:

```bash
# Create a backup before maintenance (the stack is down for about an hour)
./scripts/backup.sh -s maintenance-backup

# ... perform maintenance ...

# Restore if needed
docker compose stop
./scripts/restore.sh -s maintenance-backup
```

**Note:** The backup script uses `docker compose stop` instead of `docker compose down` to preserve container state and networks, allowing for faster restart with `docker compose start`.

### Network topology changes need a manual network recreate

Preserving networks has a consequence: **`deploy.sh` cannot apply a change to a
network's `ipam` settings** (subnet, `ip_range`, gateway). Compose compares only
whether a network *exists*, never whether its settings still match the compose
file, so it reuses the old network and then fails when a container asks for a
static `ipv4_address` the old subnet does not contain:

```
Error response from daemon: invalid config for network homy_ingress:
user specified IP address is supported only when connecting to networks with user configured subnets
```

`deploy.sh` treats the failed `up` as a failed deploy and rolls back, but the
change cannot be applied that way. Deploy such a change by hand instead:

```bash
# 1. Add any new variables to .env FIRST, and confirm nothing is unset.
docker compose config >/dev/null   # aborts on a missing required variable

# 2. Stop only the services attached to the network being changed.
docker compose stop ingress ha grafana z2m-home1 mongo-express

# 3. Remove it. This succeeds once its containers are stopped.
docker network rm homy_ingress

# 4. Bring them back; compose recreates the network from the compose file.
docker compose -f docker-compose.yml -f docker-compose.deploy.yml up -d
```

Required variables use the `${VAR:?message}` form, so step 1 fails loudly and
touches nothing if `.env` is incomplete. Do not skip it: with the network still
present from a previous deploy, an empty value would otherwise be accepted
silently, leaving the network unpinned and the stack green but broken — this is
exactly how issue #1555 happened.

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

A service whose image did not change is retagged with the new SHA; the retag copies the manifest, so its digest stays the same. `deploy.sh` relies on that.

### Manual Image Pull

To manually pull a specific version:

```bash
IMAGE_TAG=abc1234 docker compose pull automations mqtt-influx
```

## Database Rollback Strategy

### Understanding Data Loss on Rollback

A failed deploy rolls back **code and images only**. Data is never rolled back automatically, so nothing written since the deploy is lost.

Restoring data is a separate, manual decision:

- `restore-snapshot.sh` restores chosen services from the deploy snapshot; only what those services wrote since the deploy is replaced.
- `rollback.sh` restores the whole stack from a volman backup; everything written since that backup is lost.

### Database Types and Impact

| Database | Type | Impact of a restore | Notes |
|----------|------|-----------------|-------|
| InfluxDB | Time-series | Lose sensor readings since the snapshot/backup | Index may be rebuilt on start after a snapshot restore |
| MongoDB | Document | Lose historical records | Journal recovery on start |
| HA SQLite | Config/state | Lose state changes | WAL replay on start |

### When a Data Restore is Acceptable

A data restore is for emergencies where:
- A stateful service cannot start on its migrated data
- A critical bug corrupted data
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

Deploy tuning (environment of `deploy.sh`):

| Variable | Default | Meaning |
|---|---|---|
| `SNAPSHOT_MIN_FREE_GB` | 20 | Refuse the snapshot when the pool has less free space (GiB) |
| `HEALTH_STABLE_SECONDS` | 30 | A service without a healthcheck passes after running this long without a restart |
| `HEALTH_POLL_INTERVAL` | 5 | Seconds between health checks |
| `HEALTH_GATE_MARGIN` | 60 | Seconds added to the gate's time limit |
| `COMPOSE_TIMEOUT` | 600 | Seconds a `docker compose up` or `start` may take (it waits for `depends_on: service_healthy`); a timeout counts as a failure |

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

Deployment logs are stored in `logs/deploy-*.log`. They include the snapshot name, the services compose was expected to recreate, the ones it did recreate, and each service's health result:

```bash
# View most recent deployment log
ls -lt logs/deploy-*.log | head -1 | xargs cat
```

### Snapshot Failures

```bash
./scripts/snapshot.sh --check
```

names what is wrong: data on more than one dataset, a directory not on ZFS, a Docker volume holding state, too little free space, or a missing `zfs allow ... snapshot` permission.

### Health Check Failures

If deployment fails due to health check:

1. Check service logs:
   ```bash
   docker compose logs automations mqtt-influx
   ```

2. Check container status and health:
   ```bash
   docker compose ps
   docker inspect --format '{{json .State.Health}}' <container>
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

List available backups (with `complete` / `INCOMPLETE`):

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
docker compose run --rm volman seal BACKUP_NAME stopped
docker compose run --rm volman restore BACKUP_NAME
```

## Prerequisites

The following must be in place on the production server:

| Requirement | Purpose | Installation |
|------|---------|--------------|
| docker | Container runtime | https://docs.docker.com/engine/install/ |
| docker compose **v2** (plugin) | Orchestration, `--no-build`/`--pull never`, the health gate | https://docs.docker.com/compose/install/linux/ |
| git | Version control | `apt install git` |
| jq | JSON processing for the override and the health gate | `apt install jq` |
| curl | API requests (notifications) | `apt install curl` |
| ZFS | The stack's data on **one** dataset | host setup |
| `zfs allow <deploy user> snapshot <dataset>` | Deploy snapshots without sudo | host setup |
| Pruning of `@homy-deploy-*` snapshots | Snapshots are never destroyed by these scripts | host setup |
| No cron job that runs `docker compose start` | It would restart services behind the deploy's and `backup.sh --stop`'s back (#1589) | host setup |

## Pre-Deployment Checklist

Before deploying to production:

1. [ ] All tests pass in CI
2. [ ] App images built and pushed to GHCR
3. [ ] GHCR authentication configured on production server
4. [ ] All prerequisites installed (docker compose v2, jq, git, curl)
5. [ ] `./scripts/snapshot.sh --check` passes
6. [ ] Telegram notifications configured (optional)
7. [ ] A deploy that changes `influxdb`, `broker`, `z2m-home1`, `vpn` or a Modbus poller is announced

## Post-Deployment Verification

After successful deployment:

1. Check Grafana dashboards for data continuity
2. Verify Home Assistant entities are responding
3. Confirm MQTT messages are flowing
4. Check Telegram for successful deployment notification

## Notifications

The deployment scripts send Telegram notifications for:

- Successful deployments (with the recreated services and the snapshot name)
- Deployment failures, including a snapshot that failed and a health gate that could not check
- Rollback completion, and CRITICAL messages when a stateful service is left for a manual restore or the rollback itself fails

Configure by creating the secrets:

```bash
echo "your-bot-token" > secrets/telegram_bot_token
echo "your-chat-id" > secrets/telegram_chat_id
```

The scripts read them from the directory named by `SECRETS_PATH` (environment, else the `SECRETS_PATH=` line in `.env`, else `secrets/`), the same directory `docker-compose.yml` uses. Each message is also recorded as a `telegram.sent` JSON line: `journalctl -t homy-deploy` (`-t homy-rollback` for rollbacks).
