# Test Validation 1: Incremental Build

This file tests that only the changed service (automations) is built,
and all services sharing the same build context receive the correct tags.

Expected behavior:
- Detection should find: automations, features, boiler-controller, ha_discovery (all share docker/automations)
- Build groups should create ONE matrix job with build_path=docker/automations
- Build step should create tags for ALL 4 services
- Lights test should be able to pull automations:SHA

Test timestamp: 2026-03-31T19:52:00Z
