#!/bin/sh

# Reports how many shards failed to open (#1685).
#
# When a shard cannot be opened, influxd logs "Failed to open shard" and keeps
# running, so a whole week of data becomes unreadable without any other sign
# (#1370). This loop counts the shards that are in the meta store (SHOW SHARDS)
# and on disk, but are not open (SHOW STATS lists only open shards), and writes
# the count as "influxdb_health failed_shards=<n>i". A Grafana alert pages on it.
#
# Shards without a directory are skipped: the meta store creates next week's
# shard ahead of time, and influxd creates its directory only on the first write.
#
# The first check runs when /health answers. influxd opens all shards before it
# starts the HTTP server, so the check never runs while shards are still loading.

INTERVAL="${SHARD_CHECK_INTERVAL:-900}"
DATA_DIR="${INFLUXDB_DATA_DIR:-/var/lib/influxdb/data}"

# The influx CLI reads the credentials from these variables, so they do not
# show up in the process list. SHOW SHARDS needs an admin user.
export INFLUX_USERNAME="${INFLUXDB_ADMIN_USER}"
export INFLUX_PASSWORD="${INFLUXDB_ADMIN_PASSWORD}"

log() {
  echo "shard-check: $*" >&2
}

check() {
  shards=$(influx -format csv -execute 'SHOW SHARDS') || return 1
  stats=$(influx -format csv -execute "SHOW STATS FOR 'shard'") || return 1

  # One "database/retention_policy/id" line per shard; header lines are skipped
  shard_paths=$(echo "$shards" | awk -F, '$2 ~ /^[0-9]+$/ { print $3 "/" $4 "/" $2 }')
  if [ -z "$shard_paths" ]; then
    log "SHOW SHARDS returned no shards"
    return 1
  fi
  # The tags column holds "database=...,engine=tsm1,id=<id>,..."
  open_ids=" $(echo "$stats" | sed -n 's/.*,id=\([0-9]*\),.*/\1/p' | tr '\n' ' ') "

  count=0
  failed=""
  while read -r shard; do
    [ -d "$DATA_DIR/$shard" ] || continue
    case "$open_ids" in *" ${shard##*/} "*) continue ;; esac
    count=$((count + 1))
    failed="$failed $shard"
  done <<EOF
$shard_paths
EOF

  [ "$count" -eq 0 ] || log "$count shard(s) failed to open:$failed"
  influx -database "$INFLUXDB_DB" -execute "INSERT influxdb_health failed_shards=${count}i"
}

until wget -q -O /dev/null http://localhost:8086/health; do
  sleep 5
done

while :; do
  check || log "check failed"
  sleep "$INTERVAL"
done
