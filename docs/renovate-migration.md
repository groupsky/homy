# Renovate Migration Guide

This document explains the migration from Dependabot to Renovate for dependency management.

## Why Renovate?

Renovate provides several advantages over Dependabot:

1. **Synchronized Updates**: Can update multiple files in a single PR (e.g., Dockerfile + .nvmrc)
2. **Advanced Grouping**: More flexible grouping and scheduling options
3. **Post-Upgrade Tasks**: Can run commands after updating dependencies (used for .nvmrc sync)
4. **Better Customization**: More granular control over update behavior
5. **Dependency Dashboard**: Visual dashboard of all pending updates

## Key Features

### .nvmrc Synchronization

**Existing CI Validation:**
The repository already has `.nvmrc` validation in `.github/workflows/ci-unified.yml` (Stage 4A: Version Consistency Check) that ensures Dockerfile and `.nvmrc` versions match. This catches mismatches and fails the build.

**Renovate Enhancement:**
Renovate's `postUpgradeTasks` **automatically updates** `.nvmrc` files when Dockerfiles change, eliminating manual fixes. Instead of CI failing and requiring manual intervention, the `.nvmrc` updates happen automatically in the same PR.

The system uses a two-step workflow to keep Node.js versions synchronized:

**Step 1: Base Image Update (Renovate)**
- Renovate detects new Node.js versions on Docker Hub
- Creates PR to update `base-images/node-XX-alpine/Dockerfile`
- Example: `FROM node:18.20.8-alpine` → `FROM node:18.20.9-alpine`

**Step 2: Service Update Cascade (Automated Workflow)**
- When base image Dockerfile merges to master, triggers `cascade-base-image-updates` workflow
- Workflow automatically:
  1. Detects which base images changed
  2. Finds all services using those base images
  3. Updates service Dockerfiles: `ghcr.io/groupsky/homy/node:18.20.8-alpine` → `18.20.9-alpine`
  4. Syncs `.nvmrc` files: `18.20.8` → `18.20.9`
  5. Creates single PR with all changes

**Example Cascade PR:**
```
chore(deps): Cascade base image updates to services

Base Images Changed: node-18-alpine
Services Updated: automations, mqtt-influx, dmx-driver

Changes:
- docker/automations/Dockerfile: 18.20.8 → 18.20.9
- docker/automations/.nvmrc: 18.20.8 → 18.20.9
- docker/mqtt-influx/Dockerfile: 18.20.8 → 18.20.9
- docker/mqtt-influx/.nvmrc: 18.20.8 → 18.20.9
- docker/dmx-driver/Dockerfile: 18.20.8 → 18.20.9
- docker/dmx-driver/.nvmrc: 18.20.8 → 18.20.9
```

**Why Two Steps?**
- Base images (`ghcr.io/groupsky/homy/*`) are public GHCR mirrors of Docker Hub images
- Renovate tracks base-images/ (Docker Hub sources) but needs help propagating to services
- Cascade workflow automates the propagation from base images to services
- Without cascade, you'd need to manually update each service's Dockerfile when base images change

### Update Grouping

Updates are grouped by service category to reduce PR noise:

| Group | Services | Schedule |
|-------|----------|----------|
| **base-images** | All base images in `base-images/` | Weekly (Monday 2 AM) |
| **infrastructure** | nginx, mosquitto, influxdb, grafana, mongo, etc. | Monthly (1st, 2 AM) |
| **mqtt-services** | automations, automation-events-processor, mqtt-influx, mqtt-mongo | Monthly (1st, 2 AM) |
| **hardware-integration** | modbus-serial, dmx-driver, telegram-bridge | Monthly (1st, 2 AM) |
| **monitoring** | historian, sunseeker-monitoring | Monthly (1st, 2 AM) |
| **home-automation** | homeassistant | Monthly (1st, 2 AM) |
| **development** | test | Monthly (1st, 2 AM) |
| **github-actions** | All GitHub Actions | Monthly (1st, 2 AM) |

### Dependency Dashboard

Renovate creates a "Dependency Updates Dashboard" issue that shows:

- ✅ All open update PRs
- ⏰ Scheduled updates waiting for next run
- ❌ Updates that failed or were rate-limited
- 🔄 Updates awaiting user approval

Access the dashboard at: https://github.com/groupsky/homy/issues (look for "Dependency Updates Dashboard")

## Configuration Files

### renovate.json

Main Renovate configuration file at repository root.

**Key sections:**

```json
{
  "packageRules": [
    {
      "description": "Update .nvmrc files when Node.js Docker base images are updated",
      "matchPaths": ["docker/**"],
      "matchManagers": ["dockerfile"],
      "matchDatasources": ["docker"],
      "matchPackagePatterns": ["^ghcr.io/groupsky/homy/node"],
      "postUpgradeTasks": {
        "commands": [
          "bash script to extract version and update .nvmrc"
        ],
        "fileFilters": ["**/.nvmrc"]
      }
    }
  ]
}
```

### .github/workflows/renovate.yml

GitHub Actions workflow that runs Renovate on a schedule.

**Triggers:**
- **Schedule**: Monday 2 AM (base images), 1st of month 2 AM (all dependencies)
- **Manual**: workflow_dispatch with options for log level and dry-run mode
- **Push**: When renovate.json or workflow file changes (for testing)

## Setup Requirements

### 1. Create Renovate GitHub App

**Option A: Use Mend Renovate (Recommended)**

1. Go to https://github.com/apps/renovate
2. Click "Install" and select your repository
3. Renovate will automatically start creating PRs

**Option B: Self-Hosted with GitHub App**

1. Create a GitHub App at https://github.com/settings/apps/new
2. Required permissions:
   - **Contents**: Read & Write (to create commits)
   - **Pull Requests**: Read & Write (to create PRs)
   - **Issues**: Read & Write (for dependency dashboard)
   - **Metadata**: Read-only
3. Generate a private key and download it
4. Install the app on your repository

### 2. Configure GitHub Secrets

Add the following secrets to your repository:

```
RENOVATE_APP_ID=123456
RENOVATE_APP_PRIVATE_KEY=-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
```

**Where to find these:**
- **App ID**: GitHub App settings → About section
- **Private Key**: Generated when creating the app

### 3. Test Configuration

```bash
# Dry-run mode (no PRs created)
gh workflow run renovate.yml -f dryRun=true -f logLevel=debug

# Check workflow logs
gh run list --workflow=renovate.yml
gh run view <run-id> --log
```

## Migration Checklist

- [x] Create `renovate.json` configuration
- [x] Create `.github/workflows/renovate.yml`
- [x] Create `.github/workflows/cascade-base-image-updates.yml`
- [x] Create `scripts/test-nvmrc-sync.sh` validation script
- [x] Create migration documentation
- [ ] Set up Renovate GitHub App
- [ ] Configure repository secrets (RENOVATE_APP_ID, RENOVATE_APP_PRIVATE_KEY)
- [ ] Test Renovate with dry-run mode
- [ ] Test cascade workflow manually
- [ ] Disable Dependabot (rename `.github/dependabot.yml` → `.github/dependabot.yml.disabled`)
- [ ] Disable Dependabot coverage workflow (rename to `.disabled`)
- [ ] Create initial Renovate PRs
- [ ] Verify .nvmrc synchronization works
- [ ] Verify cascade workflow works
- [ ] Update CLAUDE.md documentation

## Comparison: Dependabot vs Renovate

| Feature | Dependabot | Renovate |
|---------|------------|----------|
| **Multi-file updates** | ❌ No | ✅ Yes (Dockerfile + .nvmrc) |
| **Dependency Dashboard** | ❌ No | ✅ Yes |
| **Post-upgrade tasks** | ❌ No | ✅ Yes (bash scripts) |
| **Grouping flexibility** | ⚠️ Basic | ✅ Advanced (paths, patterns) |
| **Schedule control** | ⚠️ Limited | ✅ Full cron expressions |
| **Platform support** | GitHub only | GitHub, GitLab, Bitbucket, etc. |
| **Package manager support** | 14 | 90+ |
| **Automerge** | ✅ Yes | ✅ Yes (more flexible) |
| **Native GitHub integration** | ✅ Built-in | ⚠️ Requires app setup |

## Rollback Plan

If Renovate doesn't work as expected:

1. **Disable Renovate**:
   ```bash
   # Rename or delete workflow
   mv .github/workflows/renovate.yml .github/workflows/renovate.yml.disabled
   ```

2. **Re-enable Dependabot**:
   ```bash
   # Restore Dependabot config
   mv .github/dependabot.yml.disabled .github/dependabot.yml
   mv .github/workflows/dependabot-coverage.yml.disabled .github/workflows/dependabot-coverage.yml
   ```

3. **Close Renovate PRs**:
   ```bash
   # Close all open Renovate PRs
   gh pr list --author renovate[bot] --state open | while read pr _; do
     gh pr close $pr
   done
   ```

## Testing

### Test .nvmrc Synchronization

The repository has existing CI validation (`.github/workflows/ci-unified.yml` Stage 4A) that verifies `.nvmrc` matches Dockerfile versions. For local testing before pushing, use the validation script:

```bash
# Check all services
./scripts/test-nvmrc-sync.sh

# Check specific service
./scripts/test-nvmrc-sync.sh docker/automations
```

This duplicates the CI validation logic for convenience during local development.

**Expected Output:**
```
Node.js Version Synchronization Test
=====================================

Checking: docker/automations
  Docker Node.js version: 18.20.8
  .nvmrc version: 18.20.8
  ✓ Versions match

Summary
=================================
Total services checked: 10
Passed: 10
Failed: 0
```

### Test Cascade Workflow

**Manual test of cascade workflow:**

```bash
# Dry-run mode (no PR created)
gh workflow run cascade-base-image-updates.yml \
  -f baseImage=node-18-alpine \
  -f dryRun=true

# Check workflow logs
gh run list --workflow=cascade-base-image-updates.yml
gh run view <run-id> --log
```

**Test end-to-end:**

1. Update a base image manually:
   ```bash
   # Edit base image Dockerfile
   vim base-images/node-18-alpine/Dockerfile
   # Change: FROM node:18.20.8-alpine → FROM node:18.20.9-alpine

   # Commit and push to master
   git add base-images/node-18-alpine/Dockerfile
   git commit -m "chore(base-images): update node to 18.20.9"
   git push origin master
   ```

2. Cascade workflow automatically triggers

3. Check for PR creation:
   ```bash
   # Wait a few minutes for workflow to complete
   gh pr list --label dependencies
   ```

4. Verify PR contents:
   - All services using node-18-alpine should be updated
   - All corresponding .nvmrc files should be updated
   - Single PR with all changes

### Test Renovate

**Dry-run test:**

```bash
# Run Renovate without creating PRs
gh workflow run renovate.yml -f dryRun=true -f logLevel=debug

# Check logs
gh run list --workflow=renovate.yml
gh run view <run-id> --log
```

**Check what Renovate will do:**

```bash
# Install Renovate CLI locally (optional)
npm install -g renovate

# Run locally in dry-run mode
RENOVATE_TOKEN=<your-github-token> \
  renovate --dry-run=true \
  --platform=github \
  --token=<your-github-token> \
  <owner>/<repo>
```

## Monitoring and Maintenance

### Check Renovate Status

```bash
# View Renovate workflow runs
gh run list --workflow=renovate.yml

# View specific run logs
gh run view <run-id> --log

# Check for open Renovate PRs
gh pr list --author renovate[bot]
```

### Review Dependency Dashboard

Check the dashboard issue for:
- Pending updates
- Rate-limited dependencies
- Failed updates requiring manual intervention

### Adjust Schedules

Edit `renovate.json` to change update schedules:

```json
{
  "schedule": {
    "base-images": ["before 3am on Monday"],  // Weekly
    "services": ["before 3am on the first day of the month"]  // Monthly
  }
}
```

### Ignore Specific Updates

```json
{
  "ignoreDeps": [
    "node",  // Ignore all Node.js updates
    "grafana/grafana"  // Ignore Grafana updates
  ]
}
```

## Troubleshooting

### Renovate not creating PRs

**Check:**
1. Workflow is enabled: `.github/workflows/renovate.yml`
2. Secrets are configured: `RENOVATE_APP_ID`, `RENOVATE_APP_PRIVATE_KEY`
3. GitHub App is installed on the repository
4. Schedule has run (check workflow runs)

**Debug:**
```bash
# Run manually with debug logging
gh workflow run renovate.yml -f logLevel=debug -f dryRun=false
```

### .nvmrc not updating

**Check:**
1. `.nvmrc` file exists in service directory
2. Dockerfile uses `ghcr.io/groupsky/homy/node:` base image
3. Version extraction regex is correct
4. Post-upgrade task has `fileFilters: ["**/.nvmrc"]`

**Test manually:**
```bash
# Extract version from Dockerfile
grep "^FROM.*node" docker/automations/Dockerfile | sed -E "s/.*node(-[a-z]+)?:([0-9.]+).*/\2/"
```

### Rate limiting

Renovate respects GitHub API rate limits. If you hit limits:

1. Reduce `prConcurrentLimit` in `renovate.json`
2. Increase time between schedule runs
3. Use `prCreation: "not-pending"` to reduce API calls

## Further Reading

- **Renovate Docs**: https://docs.renovatebot.com/
- **Configuration Options**: https://docs.renovatebot.com/configuration-options/
- **Post-Upgrade Tasks**: https://docs.renovatebot.com/configuration-options/#postupgradetasks
- **Package Rules**: https://docs.renovatebot.com/configuration-options/#packagerules
- **Renovate vs Dependabot**: https://docs.renovatebot.com/bot-comparison/
