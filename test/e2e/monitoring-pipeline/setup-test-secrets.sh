#!/bin/bash

# Setup test secrets for E2E monitoring pipeline test
# This script copies local development secrets to the test secrets directory

set -euo pipefail

REPO_ROOT="../../../"
SECRETS_LOCAL_DIR="${REPO_ROOT}secrets.local"
SECRETS_TEST_DIR="${REPO_ROOT}secrets.test"

echo "Setting up test secrets for E2E monitoring pipeline test..."

# Create test secrets directory
mkdir -p "$SECRETS_TEST_DIR"

# Copy telegram secrets from local development
if [ -f "${SECRETS_LOCAL_DIR}/telegram_bot_token" ]; then
    cp "${SECRETS_LOCAL_DIR}/telegram_bot_token" "$SECRETS_TEST_DIR/"
    echo "✓ Copied telegram_bot_token"
else
    echo "❌ ERROR: ${SECRETS_LOCAL_DIR}/telegram_bot_token not found"
    echo "   Please create this file with your test bot token first"
    exit 1
fi

if [ -f "${SECRETS_LOCAL_DIR}/telegram_chat_id" ]; then
    cp "${SECRETS_LOCAL_DIR}/telegram_chat_id" "$SECRETS_TEST_DIR/"
    echo "✓ Copied telegram_chat_id"
else
    echo "❌ ERROR: ${SECRETS_LOCAL_DIR}/telegram_chat_id not found"
    echo "   Please create this file with your test chat ID first"
    exit 1
fi

# Create or copy InfluxDB test credentials
if [ -f "${REPO_ROOT}secrets/influxdb_read_user" ]; then
    cp "${REPO_ROOT}secrets/influxdb_read_user" "$SECRETS_TEST_DIR/"
    echo "✓ Copied influxdb_read_user from production secrets"
else
    echo "dummy_user" > "${SECRETS_TEST_DIR}/influxdb_read_user"
    echo "✓ Created dummy influxdb_read_user"
fi

if [ -f "${REPO_ROOT}secrets/influxdb_read_user_password" ]; then
    cp "${REPO_ROOT}secrets/influxdb_read_user_password" "$SECRETS_TEST_DIR/"
    echo "✓ Copied influxdb_read_user_password from production secrets"
else
    echo "dummy_password" > "${SECRETS_TEST_DIR}/influxdb_read_user_password"
    echo "✓ Created dummy influxdb_read_user_password"
fi

echo "✅ Test secrets setup complete!"
echo ""
echo "Test secrets directory: $SECRETS_TEST_DIR"
echo "Contents:"
ls -la "$SECRETS_TEST_DIR"
echo ""
echo "You can now run the E2E test with: ./run-test.sh"