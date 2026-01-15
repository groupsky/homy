#!/bin/sh
set -e

# Process _FILE environment variables to support Docker secrets pattern
# This allows reading secret values from files, similar to official Docker images
for var in $(env | grep '_FILE=' || true); do
    var_name="${var%%=*}"
    file_path="${var#*=}"

    if [ -f "$file_path" ]; then
        # Read file content and export without _FILE suffix
        # Remove any trailing whitespace/newlines
        value=$(cat "$file_path" | tr -d '\n\r')
        export "${var_name%_FILE}"="$value"
        echo "Loaded ${var_name%_FILE} from $file_path"
    else
        echo "Warning: File not found for $var_name: $file_path"
    fi
done

# Call original zigbee2mqtt entrypoint
exec /app/docker-entrypoint.sh "$@"
