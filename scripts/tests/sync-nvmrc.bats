#!/usr/bin/env bats
#
# Tests for sync-nvmrc.sh script
#
# These tests verify the .nvmrc synchronization script used by Renovate's
# postUpgradeTasks to keep Dockerfile Node.js versions in sync with .nvmrc files.
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SYNC_SCRIPT="$SCRIPT_DIR/sync-nvmrc.sh"

setup() {
  # Create temp directories for testing
  TEST_DIR=$(mktemp -d)
  DOCKERFILE="$TEST_DIR/Dockerfile"
  SERVICE_DIR="$TEST_DIR/service"
  mkdir -p "$SERVICE_DIR"
}

teardown() {
  # Clean up temp directory
  rm -rf "$TEST_DIR"
}

@test "extracts version from standard Node.js image" {
  echo "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine" > "$DOCKERFILE"
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [ "$(cat "$SERVICE_DIR/.nvmrc")" = "18.20.8" ]
  [[ "$output" =~ "Synced .nvmrc to 18.20.8" ]]
}

@test "extracts version from Node.js variant image" {
  echo "FROM node-ubuntu:18.20.8-focal" > "$DOCKERFILE"
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [ "$(cat "$SERVICE_DIR/.nvmrc")" = "18.20.8" ]
}

@test "handles multi-stage builds with tail -1" {
  cat > "$DOCKERFILE" << 'EOF'
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
FROM base AS build
FROM base AS release
EOF
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [ "$(cat "$SERVICE_DIR/.nvmrc")" = "18.20.8" ]
}

@test "exits 0 when .nvmrc doesn't exist" {
  echo "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine" > "$DOCKERFILE"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [[ "$output" =~ "No .nvmrc file" ]]
}

@test "exits 1 when Dockerfile has no Node.js image" {
  echo "FROM alpine:3.22" > "$DOCKERFILE"
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 1 ]
  [[ "$output" =~ "Failed to extract Node.js version" ]]
}

@test "skips update when .nvmrc already synced" {
  echo "FROM ghcr.io/groupsky/homy/node:18.20.8-alpine" > "$DOCKERFILE"
  echo "18.20.8" > "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [[ "$output" =~ "already synced" ]]
}

@test "updates .nvmrc when version differs" {
  echo "FROM ghcr.io/groupsky/homy/node:18.20.9-alpine" > "$DOCKERFILE"
  echo "18.20.8" > "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [ "$(cat "$SERVICE_DIR/.nvmrc")" = "18.20.9" ]
  [[ "$output" =~ "Synced .nvmrc to 18.20.9" ]]
}

@test "rejects invalid arguments (missing argument)" {
  run "$SYNC_SCRIPT" "$DOCKERFILE"

  [ "$status" -eq 1 ]
  [[ "$output" =~ "Usage:" ]]
}

@test "handles whitespace in .nvmrc file" {
  echo "FROM ghcr.io/groupsky/homy/node:22.0.0-alpine" > "$DOCKERFILE"
  echo -e "18.20.8\n\r" > "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [ "$(cat "$SERVICE_DIR/.nvmrc")" = "22.0.0" ]
}

@test "extracts version from latest Node.js LTS (22.x)" {
  echo "FROM ghcr.io/groupsky/homy/node:22.11.0-alpine" > "$DOCKERFILE"
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [ "$(cat "$SERVICE_DIR/.nvmrc")" = "22.11.0" ]
}

@test "handles complex multi-stage Dockerfile" {
  cat > "$DOCKERFILE" << 'EOF'
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
WORKDIR /app

FROM base AS dependencies
COPY package*.json ./
RUN npm ci --only=production

FROM base AS build
COPY . .
RUN npm run build

FROM base AS release
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
EOF
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 0 ]
  [ "$(cat "$SERVICE_DIR/.nvmrc")" = "18.20.8" ]
}

@test "handles empty Dockerfile" {
  touch "$DOCKERFILE"
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 1 ]
  [[ "$output" =~ "Failed to extract" ]]
}

@test "handles Dockerfile with comments only" {
  cat > "$DOCKERFILE" << 'EOF'
# This is a comment
# Another comment
EOF
  touch "$SERVICE_DIR/.nvmrc"

  run "$SYNC_SCRIPT" "$DOCKERFILE" "$SERVICE_DIR"

  [ "$status" -eq 1 ]
  [[ "$output" =~ "Failed to extract" ]]
}
