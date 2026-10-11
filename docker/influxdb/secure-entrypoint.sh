#!/bin/sh

set -e

source /load-env-files.sh

# Report shards that fail to open (#1685); only when the server itself runs
case "$1" in
  influxd|-*) /shard-check.sh & ;;
esac

exec /entrypoint.sh "$@"
