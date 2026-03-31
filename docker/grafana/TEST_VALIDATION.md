# Test Validation 3C: Parallel builds - grafana

Tests parallel execution of build_groups matrix jobs.

Expected: 3 separate build jobs run in parallel
- broker (docker/mosquitto/TEST_VALIDATION.md)
- influxdb (docker/influxdb/TEST_VALIDATION.md)
- grafana (this file)

Test timestamp: 2026-03-31T20:05:00Z
