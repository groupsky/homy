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
  INFLUXDB_USER \
  INFLUXDB_USER_PASSWORD \
  TELEGRAM_BOT_TOKEN \
  TELEGRAM_CHAT_ID
do
  load_secret $secret
done
