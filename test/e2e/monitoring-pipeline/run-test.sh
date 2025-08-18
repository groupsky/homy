#!/bin/bash

# End-to-end test runner for monitoring pipeline
# This script orchestrates the complete test environment using Docker Compose

set -euo pipefail

# Configuration
COMPOSE_BASE="../../../docker-compose.yml"
COMPOSE_TEST="docker-compose.test.yml"
PROJECT_NAME="homy-monitoring-e2e"
TIMEOUT=120  # 2 minutes timeout for service readiness

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Cleanup function
cleanup() {
    log_info "Cleaning up test environment..."
    
    # Stop and remove containers
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" down --volumes --remove-orphans 2>/dev/null || true
    
    # Remove any dangling networks
    docker network prune -f 2>/dev/null || true
    
    log_success "Cleanup completed"
}

# Set up cleanup trap
trap cleanup EXIT INT TERM

# Check prerequisites
check_prerequisites() {
    log_info "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        log_error "Docker is not installed or not in PATH"
        exit 1
    fi
    
    # Check Docker Compose
    if ! docker compose version &> /dev/null; then
        log_error "Docker Compose is not available"
        exit 1
    fi
    
    # Check if Docker is running
    if ! docker info &> /dev/null; then
        log_error "Docker daemon is not running"
        exit 1
    fi
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js is not installed or not in PATH"
        exit 1
    fi
    
    # Check if we have npm dependencies
    if [ ! -f "package.json" ]; then
        log_error "package.json not found. Please run from the test directory."
        exit 1
    fi
    
    log_success "Prerequisites check passed"
}

# Install dependencies
install_dependencies() {
    log_info "Installing test dependencies..."
    
    if [ ! -d "node_modules" ]; then
        npm install
    else
        log_info "Dependencies already installed"
    fi
    
    log_success "Dependencies ready"
}

# Wait for service to be ready
wait_for_service() {
    local service_name="$1"
    local health_check="$2"
    local max_attempts=$((TIMEOUT / 2))
    local attempt=0
    
    log_info "Waiting for $service_name to be ready..."
    
    while [ $attempt -lt $max_attempts ]; do
        if eval "$health_check" &>/dev/null; then
            log_success "$service_name is ready"
            return 0
        fi
        
        attempt=$((attempt + 1))
        sleep 2
        
        if [ $((attempt % 15)) -eq 0 ]; then
            log_info "Still waiting for $service_name... ($attempt/$max_attempts)"
        fi
    done
    
    log_error "$service_name failed to become ready within ${TIMEOUT}s"
    return 1
}

# Start test environment
start_test_environment() {
    log_info "Starting monitoring pipeline E2E test environment..."
    
    # Set project name to avoid conflicts and use test environment
    export COMPOSE_PROJECT_NAME="$PROJECT_NAME"
    
    # Use test environment configuration to avoid production secrets
    log_info "Using test environment configuration (.env.test)"
    export COMPOSE_ENV_FILES=".env.test"
    
    # Build and start only required services for monitoring pipeline
    log_info "Building and starting required services..."
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" up --build -d broker influxdb grafana mqtt-influx-automation test-runner
    
    # Wait for core services to be ready
    log_info "Waiting for core services to be ready..."
    
    # Wait for MQTT broker
    wait_for_service "MQTT broker" "docker compose --env-file .env.test -p '$PROJECT_NAME' -f '$COMPOSE_BASE' -f '$COMPOSE_TEST' exec broker mosquitto_pub -t test -m ready"
    
    # Wait for InfluxDB
    wait_for_service "InfluxDB" "docker compose --env-file .env.test -p '$PROJECT_NAME' -f '$COMPOSE_BASE' -f '$COMPOSE_TEST' exec test-runner wget -q -O - http://influxdb:8086/ping"
    
    # Wait for Grafana
    wait_for_service "Grafana" "docker compose --env-file .env.test -p '$PROJECT_NAME' -f '$COMPOSE_BASE' -f '$COMPOSE_TEST' exec test-runner wget -q -O - http://grafana:3000/api/health"
    
    # Wait for mqtt-influx-automation service
    wait_for_service "mqtt-influx-automation" "docker compose --env-file .env.test -p '$PROJECT_NAME' -f '$COMPOSE_BASE' -f '$COMPOSE_TEST' exec mqtt-influx-automation echo ready"
    
    # Give services a moment to settle
    log_info "Allowing services to settle..."
    sleep 5
    
    log_success "Test environment is ready"
}

# Run the E2E test
run_e2e_test() {
    log_info "Running monitoring pipeline E2E test..."
    
    # Copy test files to test runner container
    log_info "Copying test files to test runner container..."
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" cp . test-runner:/usr/src/test/
    
    # Install dependencies in test runner container
    log_info "Installing dependencies in test runner..."
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" exec test-runner sh -c "cd /usr/src/test && npm install"
    
    # Skip Playwright browser installation in containerized environment
    log_info "Skipping Playwright browser installation (using API-only tests)..."
    
    # Run the test inside the container with internal networking
    log_info "Running E2E test inside container..."
    
    if [ "${CI:-false}" = "true" ]; then
        # CI environment - run headless
        export CI=true
        log_info "Running in CI mode (headless)"
    else
        # Local environment - show browser (may not work in container)
        log_info "Running in local mode"
    fi
    
    # Execute the test inside the container
    log_info "Executing E2E test with explicit exit code handling..."
    
    # Run the test and capture exit code explicitly
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" exec test-runner sh -c "cd /usr/src/test && CI=${CI:-false} npm test; echo TEST_EXIT_CODE=\$?" | tee /tmp/e2e_test_output.log
    
    # Extract the exit code from the output
    local test_exit_code=$(grep "TEST_EXIT_CODE=" /tmp/e2e_test_output.log | tail -1 | cut -d'=' -f2)
    
    # If we couldn't extract the exit code, check Docker command exit code
    if [ -z "$test_exit_code" ]; then
        test_exit_code=${PIPESTATUS[0]}
    fi
    
    if [ "$test_exit_code" -eq 0 ]; then
        log_success "E2E test completed successfully!"
        return 0
    else
        log_error "E2E test failed with exit code: $test_exit_code"
        return 1
    fi
}

# Check Grafana logs for alert activity
check_grafana_alerts() {
    log_info "Checking Grafana logs for alert activity..."
    
    local alert_logs=$(docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" logs grafana --tail=100 2>/dev/null | grep -i -E "(alert|firing|telegram|notification)" || true)
    
    if [ -n "$alert_logs" ]; then
        echo "🔔 Found alert-related activity in Grafana logs:"
        echo "$alert_logs"
    else
        echo "⚠️  No alert activity found in Grafana logs"
    fi
}

# Show service logs on failure
show_service_logs() {
    log_warning "Showing service logs for debugging..."
    
    echo
    echo "=== MQTT Broker Logs ==="
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" logs --tail=50 broker || true
    
    echo
    echo "=== InfluxDB Logs ==="
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" logs --tail=50 influxdb || true
    
    echo
    echo "=== Grafana Logs ==="
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" logs --tail=50 grafana || true
    
    echo
    echo "=== mqtt-influx-automation Logs ==="
    docker compose --env-file .env.test -p "$PROJECT_NAME" -f "$COMPOSE_BASE" -f "$COMPOSE_TEST" logs --tail=50 mqtt-influx-automation || true
    
    # Check for alert activity
    echo
    check_grafana_alerts
}

# Main execution
main() {
    log_info "Starting monitoring pipeline E2E test suite"
    echo
    
    # Check prerequisites
    check_prerequisites
    
    # Install dependencies
    install_dependencies
    
    # Start test environment
    start_test_environment
    
    # Run the test
    if run_e2e_test; then
        log_success "🎉 All tests passed! Monitoring pipeline is working correctly."
        echo
        log_info "Checking alert activity..."
        check_grafana_alerts
        exit 0
    else
        log_error "❌ Tests failed. Showing service logs for debugging..."
        show_service_logs
        exit 1
    fi
}

# Show usage if help requested
if [[ "${1:-}" == "--help" ]] || [[ "${1:-}" == "-h" ]]; then
    echo "Usage: $0 [options]"
    echo
    echo "End-to-end test runner for bath-lights monitoring pipeline"
    echo
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo
    echo "Environment variables:"
    echo "  CI=true       Run in CI mode (headless browser)"
    echo "  TIMEOUT=120   Service readiness timeout in seconds"
    echo
    echo "This script will:"
    echo "  1. Check prerequisites (Docker, Node.js, etc.)"
    echo "  2. Install test dependencies"
    echo "  3. Start the complete monitoring stack via Docker Compose"
    echo "  4. Wait for all services to be ready"
    echo "  5. Run the E2E test suite"
    echo "  6. Clean up the test environment"
    echo
    exit 0
fi

# Run main function
main "$@"