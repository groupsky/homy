# Two-Step Base Images Upgrade Workflow with Dependabot

This document explains the **two-step upgrade process** with base images and Dependabot, designed to **avoid Docker Hub rate limits during service CI checks**.

## Overview: The Two-Step Process

When a base image needs updating (e.g., Node.js 18.20.8 → 18.20.9), Dependabot creates **two separate PRs**:

### Step 1: Update Base Image (Docker Hub → GHCR)
- **What**: Dependabot detects upstream update and updates base image Dockerfile
- **Where**: `base-images/node-18-alpine/Dockerfile`
- **Pulls from**: Docker Hub (authenticated ✅)
- **Publishes to**: GHCR (`ghcr.io/groupsky/homy/node:18.20.9-alpine`)

### Step 2: Update Services (GHCR only)
- **What**: Dependabot detects GHCR update and updates service Dockerfiles
- **Where**: `docker/automations/Dockerfile`, `docker/modbus-serial/Dockerfile`, etc.
- **Pulls from**: GHCR only (**zero Docker Hub calls!** ✅)
- **Tests**: Full CI test suite against new base image

## Why Two Steps?

**Key Benefit**: Service CI checks **never pull from Docker Hub**, eliminating rate limit issues.

```
┌─────────────────────────────────────────────────────────────┐
│ Step 1: Base Image Update                                   │
│ ┌──────────┐    ┌────────────┐    ┌──────────────────┐    │
│ │Docker Hub│ -> │Base Image  │ -> │GHCR              │    │
│ │(once)    │    │CI Build    │    │ghcr.io/.../node  │    │
│ └──────────┘    └────────────┘    └──────────────────┘    │
│  Authenticated   1 Docker Hub       Unlimited pulls         │
│  Pull ✅         API call ✅        for services ✅        │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│ Step 2: Service Updates (3 services shown)                  │
│ ┌──────────────────┐    ┌─────────────────────────────┐   │
│ │GHCR              │ -> │Service CI: automations      │   │
│ │ghcr.io/.../node  │ -> │Service CI: modbus-serial    │   │
│ │                  │ -> │Service CI: mqtt-mongo       │   │
│ └──────────────────┘    └─────────────────────────────┘   │
│  Unlimited pulls         Zero Docker Hub calls ✅          │
│  No rate limits ✅       All tests pass ✅                 │
└─────────────────────────────────────────────────────────────┘
```

## Complete Example: Node.js 18.20.8 → 18.20.9

### Timeline

#### Week 1, Monday 9:00 AM
**Dependabot Step 1: Base Image Update**

Dependabot creates PR:
```
Title: Bump node from 18.20.8-alpine to 18.20.9-alpine in /base-images/node-18-alpine
Labels: dependencies, base-images
Files changed: 1
```

**PR contains:**
```diff
# base-images/node-18-alpine/Dockerfile
- FROM node:18.20.8-alpine
+ FROM node:18.20.9-alpine
```

**CI workflow runs:**
1. Pulls `node:18.20.9-alpine` from Docker Hub (authenticated ✅)
2. Builds `ghcr.io/groupsky/homy/node:18.20.9-alpine`
3. Tests pass

**You review and merge** (9:30 AM)

**GitHub Actions automatically:**
- Publishes `ghcr.io/groupsky/homy/node:18.20.9-alpine` to GHCR
- Image is now available for services

#### Week 1, Monday (next Dependabot run)
**Dependabot Step 2: Service Updates**

Dependabot creates 3 PRs (grouped by service category):

**PR 1: MQTT Services**
```
Title: Bump ghcr.io/groupsky/homy/node from 18.20.8-alpine to 18.20.9-alpine
Labels: dependencies, mqtt-services
Services: automations, mqtt-influx, mqtt-mongo
Files changed: 3
```

**Contains:**
```diff
# docker/automations/Dockerfile
- FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
+ FROM ghcr.io/groupsky/homy/node:18.20.9-alpine AS base

# docker/mqtt-influx/Dockerfile (uses different version)
  FROM ghcr.io/groupsky/homy/node:18.3.0-alpine3.14 AS base

# docker/mqtt-mongo/Dockerfile
- FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
+ FROM ghcr.io/groupsky/homy/node:18.20.9-alpine AS base
```

**CI workflows run for each service:**
1. ✅ Pulls `ghcr.io/groupsky/homy/node:18.20.9-alpine` from GHCR
2. ✅ **Zero Docker Hub API calls!**
3. ✅ Builds service with new base
4. ✅ Runs full test suite
5. ✅ All checks pass

**PR 2: Hardware Integration Services**
```
Title: Bump ghcr.io/groupsky/homy/node from 18.20.8-alpine to 18.20.9-alpine
Labels: dependencies, hardware-integration
Services: modbus-serial, dmx-driver
Files changed: 2
```

Same process - all CI pulls from GHCR only.

**You review and merge all PRs**

### Summary: Docker Hub API Calls

| Phase | Docker Hub Pulls | GHCR Pulls |
|-------|------------------|------------|
| **Step 1**: Base image build | 1 (authenticated) | 0 |
| **Step 2**: 3 service builds | **0** ✅ | 3 |
| **Total** | **1** | **3** |

**Without base images**: Would be 4 Docker Hub pulls (1 base + 3 services) = rate limit risk!

## Dependabot Configuration

### Base Images: Weekly Schedule
```yaml
- package-ecosystem: "docker"
  directory: "/base-images/node-18-alpine"
  schedule:
    interval: "weekly"  # Checks every Monday
  groups:
    base-images:
      patterns: ["*"]
```

**Why weekly?**
- Security updates arrive frequently
- Low PR volume (grouped)
- Fast propagation to services

### Services: Monthly Schedule
```yaml
- package-ecosystem: "docker"
  directory: "/docker/automations"
  schedule:
    interval: "monthly"  # Checks first Monday of month
  groups:
    mqtt-services:
      patterns: ["*"]
```

**Why monthly?**
- Services check **GHCR**, not Docker Hub
- Service Dockerfile updates only when base images change
- Reduces PR noise

## How Dependabot Tracks Updates

### For Base Images (Docker Hub)
```dockerfile
# base-images/node-18-alpine/Dockerfile
FROM node:18.20.8-alpine
```
- Dependabot queries **Docker Hub API** for `node:18.20.8-alpine`
- Detects when 18.20.9 is available
- Creates PR to update Dockerfile

### For Services (GHCR)
```dockerfile
# docker/automations/Dockerfile
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine AS base
```
- Dependabot queries **GitHub Container Registry API** for `ghcr.io/groupsky/homy/node:18.20.8-alpine`
- Detects when 18.20.9 is published (after Step 1 merges)
- Creates PR to update service Dockerfile

**Important**: Step 2 PRs appear after you merge and publish Step 1, typically within the next Dependabot run (same day to next week depending on schedule).

## Version Pinning Strategy

All images use **pinned versions** (not floating tags):

### Base Images
```hcl
# base-images/docker-bake.hcl
target "node-18-alpine" {
  context = "./node-18-alpine"
  tags = [
    "${REGISTRY}/node:18.20.8-alpine"  # ✅ Pinned
  ]
}
```

No floating tags like `:18-alpine` or `:latest`.

### Service Dockerfiles
```dockerfile
# ✅ Correct: Pinned version
FROM ghcr.io/groupsky/homy/node:18.20.8-alpine

# ❌ Wrong: Floating tag (Dependabot can't track)
FROM ghcr.io/groupsky/homy/node:18-alpine
```

**Why pinned versions?**
- Dependabot can detect specific version updates
- Explicit about what version each service uses
- Safer upgrades with dedicated testing

## Complete Workflow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ Upstream Release: Node.js 18.20.9                           │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ Week 1, Monday: Dependabot Weekly Check                     │
│                                                              │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ STEP 1: Base Image Update                            │   │
│ │ PR: "Bump node from 18.20.8 to 18.20.9"             │   │
│ │ File: base-images/node-18-alpine/Dockerfile         │   │
│ │ CI: Pulls from Docker Hub (authenticated) ✅         │   │
│ │ Publishes: ghcr.io/groupsky/homy/node:18.20.9-alpine│   │
│ └──────────────────────────────────────────────────────┘   │
│                         │                                    │
│                         │ Merge & Publish                    │
│                         ▼                                    │
│ ┌──────────────────────────────────────────────────────┐   │
│ │ STEP 2: Service Updates (Next Dependabot Run)       │   │
│ │ PR 1: "Bump node:18.20.8 → 18.20.9" (mqtt-services) │   │
│ │   - automations: Pulls from GHCR ✅                  │   │
│ │   - mqtt-influx: No change (uses 18.3.0)            │   │
│ │   - mqtt-mongo: Pulls from GHCR ✅                   │   │
│ │                                                       │   │
│ │ PR 2: "Bump node:18.20.8 → 18.20.9" (hardware-int)  │   │
│ │   - modbus-serial: Pulls from GHCR ✅                │   │
│ │   - dmx-driver: Pulls from GHCR ✅                   │   │
│ └──────────────────────────────────────────────────────┘   │
│                                                              │
│ All service CIs: Zero Docker Hub pulls ✅                   │
└─────────────────────────────────────────────────────────────┘
```

## Handling Multiple Node Versions

Services can use different Node.js versions:

```
base-images/
├── node-18-alpine/         (→ node:18.20.8-alpine)
├── node-18.3.0-alpine3.14/ (→ node:18.3.0-alpine3.14)
└── node-22-alpine/         (→ node:22-alpine)

docker/
├── automations/           (uses 18.20.8)
├── mqtt-influx/           (uses 18.3.0)
└── sunseeker-monitoring/  (uses 22)
```

**Each base image tracks independently:**
- Node 18.20.8 update → affects automations + modbus-serial
- Node 18.3.0 update → affects mqtt-influx only
- Node 22 update → affects sunseeker-monitoring only

## Comparison: Before vs After

### Before Base Images
```
Node 18.20.8 → 18.20.9:
├─ 3 Dependabot PRs (one per service)
│  ├─ automations: Pulls node:18.20.9 from Docker Hub
│  ├─ modbus-serial: Pulls node:18.20.9 from Docker Hub
│  └─ mqtt-mongo: Pulls node:18.20.9 from Docker Hub
├─ 3 Docker Hub API calls (rate limit risk! ⚠️)
└─ 3 separate PR reviews
```

### After Base Images ✅
```
Node 18.20.8 → 18.20.9:
├─ Step 1: Base image PR
│  └─ 1 Docker Hub pull (authenticated ✅)
├─ Step 2: Service PRs (grouped)
│  ├─ automations: Pulls from GHCR ✅
│  ├─ modbus-serial: Pulls from GHCR ✅
│  └─ mqtt-mongo: Pulls from GHCR ✅
├─ 1 Docker Hub API call total ✅
├─ Zero rate limits ✅
└─ 2 PR reviews (base + grouped services)
```

## FAQ

**Q: How long between Step 1 and Step 2?**
A: Depends on Dependabot schedule:
- Base images: Weekly (Monday 9 AM)
- Services: Monthly (first Monday 9 AM)
- If both run same day: ~1 hour between steps
- If not: Up to 1 month (you can manually trigger Dependabot)

**Q: Can I trigger Step 2 immediately after Step 1?**
A: Yes! After merging Step 1:
1. Go to repository Insights → Dependency graph → Dependabot
2. Click "Check for updates" on service groups
3. Dependabot will detect GHCR updates and create PRs

**Q: What if I want faster service updates?**
A: Change service Dependabot schedule from monthly to weekly:
```yaml
- package-ecosystem: "docker"
  directory: "/docker/automations"
  schedule:
    interval: "weekly"  # ← Changed from monthly
```

**Q: Do services automatically use new base images without Step 2?**
A: **No**. Services use pinned versions (`18.20.8-alpine`), so they need explicit Dockerfile updates via Step 2 PRs.

**Q: What happens if Step 1 fails?**
A: CI catches the issue before publishing to GHCR:
- Fix the base image Dockerfile
- Re-run CI
- Services never see broken base images

**Q: Why not use floating tags like `:18-alpine`?**
A: Three reasons:
1. Dependabot can't track floating tags
2. No explicit testing when base updates
3. Unclear which version each service uses

**Q: What about docker-compose in production?**
A: Update docker-compose.yml to use GHCR images:
```yaml
services:
  automations:
    image: ghcr.io/groupsky/homy/automations:latest
    # Pulls from GHCR, not Docker Hub ✅
```

## Troubleshooting

### Step 2 PRs not appearing?
1. Check Step 1 was merged and published
2. Verify GHCR image exists: `docker pull ghcr.io/groupsky/homy/node:18.20.9-alpine`
3. Wait for next Dependabot run (or trigger manually)
4. Check Dependabot logs in repository settings

### CI still pulling from Docker Hub?
1. Verify service Dockerfile uses `ghcr.io/groupsky/homy/*` image
2. Check there's no `pull: true` in workflows (not needed with pinned versions)
3. Confirm Docker login to GHCR is working in CI

### Too many service PRs?
- Adjust service Dependabot schedule to quarterly
- Increase grouping patterns
- Use more specific version ranges

## Benefits Summary

✅ **Zero Docker Hub rate limits for service CI**
✅ **Explicit two-step testing process**
✅ **Security updates propagate automatically**
✅ **Clear visibility into base image versions**
✅ **Grouped PRs reduce review overhead**
✅ **One Docker Hub pull per upstream update**
