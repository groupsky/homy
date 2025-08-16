#!/bin/bash

set -euo pipefail

# Configuration
COMPOSE_BASE="../../../docker-compose.yml"
COMPOSE_TEST="docker-compose.test.yml"
PROJECT_NAME="homy-monitoring-e2e"
TIMEOUT=120  # 2 minutes timeout for service readiness

export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
export COMPOSE_ENV_FILES=".env.test"
docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" "$@"
