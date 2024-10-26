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
  INFLUXDB_USERNAME \
  INFLUXDB_PASSWORD \
  MQTT_USERNAME \
  MQTT_PASSWORD
do
  load_secret $secret
done
