#!/bin/bash

# Tests shard-check.sh on a throwaway container (#1685):
# 1. A healthy instance reports failed_shards=0.
# 2. A shard broken on purpose reports failed_shards=1. It is broken with the
#    InfluxDB 1.12 fields.idxl bug from #1370: write a field, drop the
#    measurement, write the field with another type, kill influxd, start again.
#
# Usage: docker/influxdb/test-shard-check.sh  (needs docker; builds the image)

set -euo pipefail

cd "$(dirname "$0")"

IMAGE=homy-influxdb-shard-check-test
NAME=homy-influxdb-shard-check-test-$$

docker build -q -t "$IMAGE" . >/dev/null
trap 'docker rm -f "$NAME" >/dev/null 2>&1 || true' EXIT

docker run -d --name "$NAME" \
  -e INFLUXDB_DB=homy \
  -e INFLUXDB_HTTP_AUTH_ENABLED=true \
  -e INFLUXDB_ADMIN_USER=admin \
  -e INFLUXDB_ADMIN_PASSWORD=test-password \
  -e SHARD_CHECK_INTERVAL=2 \
  "$IMAGE" >/dev/null

influx() {
  docker exec -e INFLUX_USERNAME=admin -e INFLUX_PASSWORD=test-password \
    "$NAME" influx -format csv "$@"
}

wait_healthy() {
  for _ in $(seq 120); do
    [ "$(docker inspect -f '{{.State.Health.Status}}' "$NAME")" = healthy ] && return
    sleep 1
  done
  echo "FAIL: influxdb did not become healthy" >&2
  exit 1
}

# Waits until the newest failed_shards value written after $1 equals $2
expect_failed_shards() {
  local since="$1" want="$2" got=""
  for _ in $(seq 60); do
    got=$(influx -database homy \
      -execute "SELECT last(failed_shards) FROM influxdb_health WHERE time > '$since'" \
      | awk -F, 'NR == 2 { print $3 }')
    [ "$got" = "$want" ] && { echo "PASS: failed_shards=$got"; return; }
    sleep 1
  done
  echo "FAIL: failed_shards=${got:-none}, want $want" >&2
  docker logs "$NAME" 2>&1 | grep -E 'shard-check|Failed to open shard' >&2 || true
  exit 1
}

now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

wait_healthy
expect_failed_shards "$(now)" 0

influx -execute 'CREATE DATABASE broken'
influx -database broken -execute 'INSERT zz f=1i'
influx -database broken -execute 'DROP MEASUREMENT zz'
influx -database broken -execute 'INSERT zz f=1.5'
docker kill "$NAME" >/dev/null
docker start "$NAME" >/dev/null
since=$(now)

wait_healthy
docker logs "$NAME" 2>&1 | grep -q 'Failed to open shard' \
  || { echo "FAIL: the shard was not broken" >&2; exit 1; }
expect_failed_shards "$since" 1
