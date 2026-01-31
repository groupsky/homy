# Renovate Migration Guide

This document explains the migration from Dependabot to Renovate for dependency management.

## Why Renovate?

Renovate provides several advantages over Dependabot ([comparison](https://docs.renovatebot.com/bot-comparison/)):

1. **Synchronized Updates**: Can update multiple files in a single PR (e.g., Dockerfile + .nvmrc)
2. **Advanced Grouping**: More flexible [grouping](https://docs.renovatebot.com/noise-reduction/#package-grouping) and [scheduling](https://docs.renovatebot.com/noise-reduction/#scheduling) options
3. **Post-Upgrade Tasks**: Can run commands after updating dependencies ([postUpgradeTasks](https://docs.renovatebot.com/configuration-options/#postupgradetasks))
4. **Better Customization**: More granular control over update behavior ([packageRules](https://docs.renovatebot.com/configuration-options/#packagerules))
5. **Dependency Dashboard**: Visual [dashboard](https://docs.renovatebot.com/key-concepts/dashboard/) of all pending updates

## Key Features

### .nvmrc Synchronization

**Existing CI Validation:**
The repository already has `.nvmrc` validation in `.github/workflows/ci-unified.yml` (Stage 4A: Version Consistency Check) that ensures Dockerfile and `.nvmrc` versions match. This catches mismatches and fails the build.

**Renovate Enhancement:**
Renovate's [`postUpgradeTasks`](https://docs.renovatebot.com/configuration-options/#postupgradetasks) **automatically updates** `.nvmrc` files when Dockerfiles change, eliminating manual fixes. Instead of CI failing and requiring manual intervention, the `.nvmrc` updates happen automatically in the same PR via the `.github/scripts/sync-nvmrc.sh` script.

The system uses a two-step workflow to keep Node.js versions synchronized:

**Step 1: Base Image Update (Renovate)**
- Renovate detects new Node.js versions on Docker Hub
- Creates PR to update `base-images/node-XX-alpine/Dockerfile`
- Example: `FROM node:18.20.8-alpine` → `FROM node:18.20.9-alpine`

**Step 2: Service Update via Renovate (Scheduled)**
- Renovate runs on a daily schedule (weekdays after 3 AM UTC)
- Renovate automatically:
  1. Scans GHCR for updated base image versions
  2. Detects services using the updated base images
  3. Creates grouped PRs per service category (mqtt-services, infrastructure, etc.)
  4. Updates service Dockerfiles: `ghcr.io/groupsky/homy/node:18.20.8-alpine` → `18.20.9-alpine`
  5. Syncs `.nvmrc` files via `postUpgradeTasks`: `18.20.8` → `18.20.9`

**Note**: Using Mend Renovate App means updates happen on schedule, not immediately. Typical delay: < 24 hours after base image push.

**Example Renovate PR (Created Automatically):**
```
chore(deps): update mqtt-services group

Updates Node.js base image dependencies

Services Updated:
- docker/automations/Dockerfile: ghcr.io/groupsky/homy/node:18.20.8-alpine → 18.20.9-alpine
- docker/automations/.nvmrc: 18.20.8 → 18.20.9 (auto-synced)
- docker/mqtt-influx/Dockerfile: ghcr.io/groupsky/homy/node:18.20.8-alpine → 18.20.9-alpine
- docker/mqtt-influx/.nvmrc: 18.20.8 → 18.20.9 (auto-synced)

This PR was automatically created by Mend Renovate App during its scheduled run.
```

**Why Two Steps?**
- Base images (`ghcr.io/groupsky/homy/*`) are public GHCR mirrors of Docker Hub images
- Renovate tracks base-images/ (Docker Hub sources) for detecting updates
- Services use GHCR sources (docker/*/) to avoid Docker Hub rate limits
- CI pipeline automatically triggers Renovate after base image builds
- Renovate's existing grouping and .nvmrc sync configuration handles service updates
- This approach is simpler and more secure than a custom bash-based cascade workflow

### Update Grouping

Updates are [grouped by service category](https://docs.renovatebot.com/noise-reduction/#package-grouping) to reduce PR noise:

| Group | Services | Schedule | Automerge |
|-------|----------|----------|-----------|
| **base-images** | All base images in `base-images/` | Weekly (Monday 3 AM) | ✅ Patch/minor only |
| **infrastructure** | nginx, mosquitto, influxdb, grafana, mongo, etc. | Daily (weekdays after 3 AM) | ❌ Manual review |
| **mqtt-services** | automations, automation-events-processor, mqtt-influx, mqtt-mongo | Daily (weekdays after 3 AM) | ❌ Manual review |
| **hardware-integration** | modbus-serial, dmx-driver, telegram-bridge | Daily (weekdays after 3 AM) | ❌ Manual review |
| **monitoring** | historian, sunseeker-monitoring | Daily (weekdays after 3 AM) | ❌ Manual review |
| **home-automation** | homeassistant | Daily (weekdays after 3 AM) | ❌ Manual review |
| **development** | test | Monthly (1st, 3 AM) | ❌ Manual review |
| **github-actions** | All GitHub Actions | Monthly (1st, 3 AM) | ✅ All updates |
| **dev-dependencies** | npm devDependencies (all services) | Daily (weekdays after 3 AM) | ✅ All updates |

### Dependency Dashboard

Renovate creates a "[Dependency Updates Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/)" issue that shows:

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

### Using Mend Renovate App (Recommended - Current Setup)

This repository uses the **Mend Renovate App** hosted solution:

1. **Install the app**: Go to [github.com/apps/renovate](https://github.com/apps/renovate)
2. **Select repository**: Choose `groupsky/homy` during installation
3. **Grant permissions**: The app needs access to:
   - Contents (read/write) - Create commits and branches
   - Pull requests (read/write) - Create and update PRs
   - Issues (read/write) - Create dependency dashboard
   - Checks & Statuses (read/write) - Update check runs
   - See [full permission list](https://docs.renovatebot.com/modules/platform/github/#running-as-a-github-app)
4. **Done!** Renovate will automatically start running on schedule

**No secrets or workflow files needed** - Mend app handles everything automatically.

**Configuration**: The `renovate.json` file in repository root controls Renovate's behavior ([configuration reference](https://docs.renovatebot.com/configuration-options/)).

## Migration Checklist

- [x] Create `renovate.json` configuration ([docs](https://docs.renovatebot.com/configuration-options/))
- [x] Create `.github/scripts/sync-nvmrc.sh` script
- [x] Configure automerge settings ([docs](https://docs.renovatebot.com/key-concepts/automerge/))
- [x] Create migration documentation
- [x] Install Mend Renovate App ([install link](https://github.com/apps/renovate))
- [ ] Disable Dependabot (rename `.github/dependabot.yml` → `.github/dependabot.yml.disabled`)
- [ ] Wait for first Renovate run (check [Dependency Dashboard](https://docs.renovatebot.com/key-concepts/dashboard/) issue)
- [ ] Verify .nvmrc synchronization works (check first Node.js update PR)
- [ ] Verify automerge works for base images/actions/devDependencies
- [ ] Monitor for 1-2 weeks, adjust schedules if needed
- [ ] Update CLAUDE.md documentation

## Comparison: Dependabot vs Renovate

See [official comparison](https://docs.renovatebot.com/bot-comparison/) for more details.

| Feature | Dependabot | Renovate |
|---------|------------|----------|
| **Multi-file updates** | ❌ No | ✅ Yes (Dockerfile + .nvmrc via [postUpgradeTasks](https://docs.renovatebot.com/configuration-options/#postupgradetasks)) |
| **Dependency Dashboard** | ❌ No | ✅ Yes ([docs](https://docs.renovatebot.com/key-concepts/dashboard/)) |
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

The repository has existing CI validation (`.github/workflows/ci-unified.yml` Stage 4A) that verifies `.nvmrc` matches Dockerfile versions. This runs automatically on all PRs.

Renovate's `postUpgradeTasks` ensures `.nvmrc` files are updated automatically when Dockerfiles change, so the CI validation should always pass.

### Test Renovate Trigger Integration

**Manual test of Renovate trigger:**

The CI pipeline automatically triggers Renovate after base images are built. You can test this manually:

```bash
# Option 1: Trigger Renovate directly
gh workflow run renovate.yml --ref master -f logLevel=info

# Option 2: Test the full flow (trigger CI which will trigger Renovate)
# This requires a base image change to actually trigger Renovate
gh workflow run ci-unified.yml --ref master
```

**Test end-to-end workflow:**

1. Update a base image to trigger the full flow:
   ```bash
   # Edit base image Dockerfile
   vim base-images/node-18-alpine/Dockerfile
   # Change: FROM node:18.20.8-alpine → FROM node:18.20.9-alpine

   # Commit and push to master
   git add base-images/node-18-alpine/Dockerfile
   git commit -m "chore(base-images): update node to 18.20.9"
   git push origin master
   ```

2. CI pipeline runs and triggers Renovate:
   - Stage 2: Builds and pushes updated base image to GHCR
   - Stage 7: Triggers Renovate workflow via `workflow_dispatch`

3. Renovate workflow runs:
   - Scans GHCR for updated base images
   - Creates grouped PRs for affected services

4. Check for PR creation:
   ```bash
   # Wait a few minutes for workflows to complete
   gh pr list --author renovate[bot] --label dependencies
   ```

5. Verify PR contents:
   - Services grouped by category (mqtt-services, infrastructure, etc.)
   - Dockerfiles updated with new base image versions
   - .nvmrc files automatically synced
   - Consistent commit message formatting

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
