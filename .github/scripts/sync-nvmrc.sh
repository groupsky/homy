#!/usr/bin/env bash
#
# Sync .nvmrc file with Node.js version from Dockerfile
#
# This script is called by Renovate's postUpgradeTasks when a Dockerfile
# with a Node.js base image is updated. It extracts the Node.js version
# from the Dockerfile and updates the corresponding .nvmrc file.
#
# Usage: sync-nvmrc.sh <dockerfile-path> <service-directory>
#
# Arguments:
#   dockerfile-path    - Path to the Dockerfile (e.g., docker/automations/Dockerfile)
#   service-directory  - Path to the service directory (e.g., docker/automations)
#
# Exit codes:
#   0 - Success (.nvmrc synced or already in sync)
#   1 - Error (failed to extract version or update .nvmrc)
#

set -euo pipefail

# Check arguments
if [ $# -ne 2 ]; then
  echo "Usage: $0 <dockerfile-path> <service-directory>"
  exit 1
fi

DOCKERFILE="$1"
SERVICE_DIR="$2"
NVMRC_FILE="$SERVICE_DIR/.nvmrc"

# Check if .nvmrc file exists
if [ ! -f "$NVMRC_FILE" ]; then
  echo "⊘ No .nvmrc file in $SERVICE_DIR"
  exit 0
fi

# Extract Node.js version from Dockerfile
# Uses tail -1 to match CI validation logic for multi-stage builds
# Supports both standard (node:X.Y.Z) and variant (node-ubuntu:X.Y.Z) patterns
NEW_VERSION=$(grep -E "^FROM.*node(-[a-z]+)?:" "$DOCKERFILE" | \
  sed -E "s/.*node(-[a-z]+)?:([0-9.]+).*/\2/" | \
  tail -1)

# Validate version extraction
if [ -z "$NEW_VERSION" ]; then
  echo "✗ Failed to extract Node.js version from $DOCKERFILE"
  exit 1
fi

# Read current .nvmrc version (strip whitespace)
CURRENT_VERSION=$(cat "$NVMRC_FILE" | tr -d '\n\r')

# Check if update is needed
if [ "$NEW_VERSION" = "$CURRENT_VERSION" ]; then
  echo "⊙ .nvmrc already synced ($NEW_VERSION) in $SERVICE_DIR"
  exit 0
fi

# Update .nvmrc file
echo "$NEW_VERSION" > "$NVMRC_FILE"

if [ $? -eq 0 ]; then
  echo "✓ Synced .nvmrc to $NEW_VERSION in $SERVICE_DIR"
  exit 0
else
  echo "✗ Failed to update .nvmrc in $SERVICE_DIR"
  exit 1
fi
