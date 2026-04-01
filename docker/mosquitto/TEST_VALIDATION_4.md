# Test Validation 4: Single service change with lights test dependency

This file tests the specific scenario where only the broker service changes,
which is a critical dependency for the lights integration test.

Expected behavior:
- Detection: Only broker changed
- Build groups: 1 matrix job for broker
- Build: broker built and tagged at current SHA
- Lights test: Must run and pull broker from current SHA (required dependency)
- Test result: Lights test passes with newly built broker

This validates the critical scenario where a lights test dependency is modified.

Test timestamp: 2026-04-01T05:00:00Z
