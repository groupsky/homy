# Test Validation 2: Base Image Cascade

This file tests that changing a base image triggers rebuild of all
dependent services, with build groups properly handling shared contexts.

Expected behavior:
- Detection should find changed base image: node-22-alpine
- Affected services: all services using node-22-alpine base
- Build groups should deduplicate by build_path
- All services sharing each build path get tags

Test timestamp: 2026-03-31T20:00:00Z
