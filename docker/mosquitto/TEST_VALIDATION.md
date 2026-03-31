# Test Validation 3A: Parallel builds - broker

Tests parallel execution of build_groups matrix jobs.

Expected: 3 separate build jobs run in parallel
- broker (this file, build context: docker/mosquitto)
- influxdb (TEST_VALIDATION.md)
- grafana (TEST_VALIDATION.md)

Test timestamp: 2026-03-31T20:05:00Z
