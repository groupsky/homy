# Test Validation 1: Incremental build with shared build context

This file tests that changing docker/automations triggers build of all
services sharing that build context, and lights test runs successfully
with all dependencies at current SHA.

Expected behavior:
- Detection: automations, features, boiler-controller, ha_discovery (all share docker/automations)
- Build groups: 1 matrix job with build_path=docker/automations
- Build: Creates tags for all 4 services
- Lights test: All deps (automations, broker, features) pulled from current SHA
- Result: ✅ All tests pass

Test timestamp: 2026-04-01T00:10:00Z
