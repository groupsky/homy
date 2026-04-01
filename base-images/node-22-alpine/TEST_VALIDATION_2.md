# Test Validation 2: Base image cascade build

This file tests that changing a base image triggers builds of all dependent
services.

Expected behavior:
- Detection: node-22-alpine base image changed
- Affected services: All services using node-22-alpine as base (should detect from Dockerfiles)
- Build groups: Multiple matrix jobs, one per affected service's build path
- Build: Creates tags for all affected services at current SHA
- Lights test: If lights test runs, it should pull dependencies correctly

Test timestamp: 2026-04-01T04:00:00Z
