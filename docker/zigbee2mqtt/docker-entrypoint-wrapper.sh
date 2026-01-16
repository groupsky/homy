#!/bin/sh
set -e

# Process _FILE environment variables to support Docker secrets pattern
# This allows reading secret values from files, similar to official Docker images
for var in $(env | grep '_FILE=' || true); do
    var_name="${var%%=*}"
    file_path="${var#*=}"

    if [ ! -f "$file_path" ]; then
        echo "ERROR: Secret file not found for $var_name: $file_path"
        exit 1
    fi

    # Read file content and export without _FILE suffix
    # Remove any trailing whitespace/newlines
    value=$(cat "$file_path" | tr -d '\n\r')

    if [ -z "$value" ]; then
        echo "ERROR: Secret file is empty for $var_name: $file_path"
        exit 1
    fi

    export "${var_name%_FILE}"="$value"
    echo "✅ Loaded ${var_name%_FILE} from $file_path"
done

# Validate required configuration
REQUIRED_VARS="ZIGBEE2MQTT_CONFIG_SERIAL_PORT ZIGBEE2MQTT_CONFIG_ADVANCED_NETWORK_KEY ZIGBEE2MQTT_CONFIG_MQTT_BASE_TOPIC ZIGBEE2MQTT_CONFIG_MQTT_SERVER"

for var in $REQUIRED_VARS; do
    if ! eval "[ -n \"\$$var\" ]"; then
        echo "ERROR: Required configuration missing: $var"
        exit 1
    fi
done

echo "✅ All required configuration validated"

# Call original zigbee2mqtt entrypoint
exec /usr/local/bin/docker-entrypoint.sh "$@"
