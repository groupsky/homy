# Test Validation 3: Parallel builds for multiple services

This file (along with similar files in mosquitto and grafana) tests that
changing multiple independent services triggers parallel builds.

Expected behavior:
- Detection: broker (mosquitto), influxdb, grafana changed
- Build groups: 3 matrix jobs (one per service)
- Build: All 3 services built in parallel
- Lights test: broker should be pulled from current SHA (newly built)

Test timestamp: 2026-04-01T04:30:00Z
