#!/bin/sh

set -e

load_secret() {
  name="$1"
  eval filename="\$${name}_FILE"
  if [ -f "$filename" ]; then
    val="$(cat "${filename}")"
    export "${name}"="$val"
  fi
}

for secret in \
  DOCKER_INFLUXDB_INIT_USERNAME \
  DOCKER_INFLUXDB_INIT_PASSWORD \
  INFLUXDB_ADMIN_USER \
  INFLUXDB_ADMIN_PASSWORD \
  INFLUXDB_USER \
  INFLUXDB_USER_PASSWORD \
  INFLUXDB_READ_USER \
  INFLUXDB_READ_USER_PASSWORD \
  INFLUXDB_WRITE_USER \
  INFLUXDB_WRITE_USER_PASSWORD
do
  load_secret $secret
done
