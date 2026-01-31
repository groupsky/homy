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
| **infrastructure** | nginx, mosquitto, influxdb, grafana, mongo, etc. | Weekly (Monday 3 AM) | ❌ Manual review |
| **mqtt-services** | automations, automation-events-processor, mqtt-influx, mqtt-mongo | Weekly (Monday 3 AM) | ❌ Manual review |
| **hardware-integration** | modbus-serial, dmx-driver, telegram-bridge | Weekly (Monday 3 AM) | ❌ Manual review |
| **monitoring** | historian, sunseeker-monitoring | Weekly (Monday 3 AM) | ❌ Manual review |
| **home-automation** | homeassistant | Weekly (Monday 3 AM) | ❌ Manual review |
| **development** | test | Monthly (1st, 3 AM) | ❌ Manual review |
| **github-actions** | All GitHub Actions | Monthly (1st, 3 AM) | ✅ Patch/minor only |
| **dev-dependencies** | npm devDependencies (all services) | Immediate | ✅ All updates |

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
- [x] Disable Dependabot (rename `.github/dependabot.yml` → `.github/dependabot.yml.disabled`)
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
   - Uninstall Mend Renovate App:
     - Go to GitHub repository Settings → Integrations → Applications
     - Remove "Mend Renovate" app
     - This immediately stops all Renovate activity
   - Or temporarily disable via config:
     ```bash
     mv renovate.json renovate.json.disabled
     ```

2. **Re-enable Dependabot**:
   ```bash
   # Restore Dependabot config
   mv .github/dependabot.yml.disabled .github/dependabot.yml
   mv .github/workflows/dependabot-coverage.yml.disabled .github/workflows/dependabot-coverage.yml
   ```

3. **Close Renovate PRs and Dashboard**:
   ```bash
   # Close all open Renovate PRs
   gh pr list --author "renovate[bot]" --state open --json number --jq '.[].number' | while read pr; do
     gh pr close $pr --comment "Reverting to Dependabot"
   done

   # Close dependency dashboard issue
   gh issue list --author "renovate[bot]" --label "renovate" --json number --jq '.[].number' | while read issue; do
     gh issue close $issue
   done
   ```

## Testing

### Test .nvmrc Synchronization

The repository has existing CI validation (`.github/workflows/ci-unified.yml` Stage 4A) that verifies `.nvmrc` matches Dockerfile versions. This runs automatically on all PRs.

Renovate's `postUpgradeTasks` ensures `.nvmrc` files are updated automatically when Dockerfiles change, so the CI validation should always pass.

### Verify Mend Renovate App Setup

**IMPORTANT**: Mend Renovate App runs on Renovate's schedule and **cannot be manually triggered**.

**Verify Installation:**

```bash
# Check that Renovate app has repository access
gh api repos/groupsky/homy/installation
```

**Monitor First Run:**

1. Wait for Renovate's scheduled run (check schedule in `renovate.json`)
2. Check for Dependency Dashboard issue creation:
   ```bash
   gh issue list --label renovate
   ```
3. Verify PR creation:
   ```bash
   gh pr list --author "renovate[bot]"
   ```

**Verify .nvmrc Synchronization:**

When Renovate creates its first Node.js base image update PR:
1. Check that the PR includes both Dockerfile and `.nvmrc` changes
2. Verify versions match between files
3. Look for "auto-synced" mention in commit message or PR description
4. Confirm CI Stage 4A validation passes

**Expected Timeline:**
- Base images: Check weekly on Monday ~3 AM UTC
- Services: Check daily on weekdays ~3 AM UTC
- First PR may take 24-48 hours after installation

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

**For Mend Renovate App:**

1. **Verify app installation**:
   ```bash
   # Check if Renovate app has access
   gh api repos/groupsky/homy/installation
   ```

2. **Check permissions**: App needs:
   - Contents (read/write)
   - Pull requests (read/write)
   - Issues (read/write)
   - Checks & Statuses (read/write)

3. **Verify schedule**: Check `renovate.json` schedule settings match your expectations

4. **Check dashboard**: Look for "Dependency Updates Dashboard" issue for status messages

5. **Review logs**: Renovate logs are not directly accessible with Mend app. Check:
   - Dashboard issue for errors
   - Failed check runs on open PRs

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
