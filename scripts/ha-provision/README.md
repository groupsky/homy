# ha-provision

Applies [`config/home-assistant/provision.json`](../../config/home-assistant/provision.json)
to the running Home Assistant. It covers what HA keeps only in `.storage` and
cannot take from YAML:

- **Entity exposure to assistants** (`exposure`). For example, Assist
  (`conversation`) must never be able to switch `switch.1217_mariboli`.
- **Rows of storage-mode dashboards** (`dashboards.<url_path>.rows`). Each
  desired row replaces the row for the same entity on any `entities` card, in
  place. The rest of the dashboard stays editable in the UI.
- **Whole dashboards** (`dashboards.<url_path>.config`, with `title` and
  `icon`). The script creates the dashboard when it is missing and saves the
  whole config when it differs, so the repo owns it in full: an edit in the UI
  is replaced on the next run. The `url_path` needs a hyphen. `title` and
  `icon` are used only when the dashboard is created; change them later in the
  UI (Settings → Dashboards). Today: `dashboard-ioniq` (#1800) and `dashboard-oven` (#1898).
- **Registry names** (`registry_names`), keyed by entity id:
  `{ "name": <entity name>, "device": <device name> }`, either optional. The
  script writes only two fields: the entity registry `name` and the
  `name_by_user` of the entity's device, found through the entity's
  `device_id`. It never changes an entity id, and it writes only a value that
  differs. The More-info header is built from these names, so they are the
  Bulgarian names of devices that come from outside the repo, such as the
  Zigbee2MQTT ones (#1849). An entity name set here becomes the whole state
  `friendly_name`, without the device name, so such an entity also keeps its
  full name ("<device> <entity>") in `configuration/customize.yaml`, for the
  Energy page and the history. Entities without a device are named only
  there. Do not put an IEEE address, MAC or serial
  here: this repo is public. The script stops, and exits `1`, when an entity
  is not in the registry, has no device to name, or names one device twice
  differently.

- **Proxy trust** (`http`, #1820). Since 2026.8 HA keeps its HTTP settings
  in `/config/.storage/http` and ignores an `http:` YAML block, so
  `configuration.yaml` has none. `"use_x_forwarded_for": true` here, with the
  proxy address from the `TRUSTED_PROXIES` environment variable, which
  `scripts/deploy.sh` fills from `PROXY_BACKEND_ADDRESS` in `.env` (nginx's
  pinned address). The address is not in the repo. Without this trust HA
  answers 400 to every request through nginx (#1555). To change the proxy,
  change `PROXY_BACKEND_ADDRESS` and deploy: the deploy runs this step every
  time (`--http-only`), as git does not see `.env` change. HA applies a new setting only by **restarting**, as a
  trial that reverts by itself after 5 minutes unless it is confirmed. The
  script waits for the restart (up to 100 s per run) and then confirms it;
  if HA is slower, run it again and it carries on. This step runs first, and
  `--http-only` runs only it (CI does this on its fresh HA).

A rebuilt data volume reverts all of these, and an edit in the UI reverts what it
touches. Re-run the script to restore them. It is idempotent.

## Safety checks

The script refuses to save, and exits `1`, in two cases:

- **A desired entity is on no `entities` card.** The script does not decide
  where a control goes. Add the row in the UI, then re-run.
- **The entity also appears somewhere a row's `tap_action.confirmation` does
  not cover**, such as a tile card or a glance card. A default toggle row, a
  tile's icon and the more-info dialog all switch the entity without asking.

Every replaced row, and the previous config of a whole dashboard, is printed,
so the run's own output is the rollback. A whole dashboard in YAML mode cannot
be saved, and the script stops.

## Running it on routy

It needs a long-lived access token of an **admin** user. The token is created
in HA under Profile → Security. Store it as `ha_provision_token` in the secrets
directory (`SECRETS_PATH`); see [`secrets/ha_provision_token`](../../secrets/ha_provision_token).

Run from the checkout, dry run first:

```bash
secrets=$(realpath "$(sed -n 's/^SECRETS_PATH=//p' .env)")
docker run --rm --network homy_automation \
  -v "$PWD":/w:ro \
  -v "$secrets/ha_provision_token":/run/secrets/ha_provision_token:ro \
  -e HA_GRAFANA_BASE_URL="$(sed -n 's/^HA_GRAFANA_BASE_URL=//p' .env)" \
  -e TRUSTED_PROXIES="$(sed -n 's/^PROXY_BACKEND_ADDRESS=//p' .env)" \
  ghcr.io/groupsky/homy/node:22.22.0-alpine3.23 \
  node /w/scripts/ha-provision/index.mjs --dry-run
```

Drop `--dry-run` to apply.
`scripts/deploy.sh` runs the same command after a successful deploy (see
`docs/DEPLOYMENT.md`), so a hand run is needed only when the deploy reports
that it failed or was skipped. No container is restarted, and HA applies all
changes live, except a change of the proxy trust, which restarts HA.

Two settings come from `.env`. `PROXY_BACKEND_ADDRESS` is the proxy HA
trusts, passed as `TRUSTED_PROXIES` (see above). `HA_GRAFANA_BASE_URL` is the base of the
dashboards' Grafana links. In `provision.json` such a link is written
`[name](grafana:/d/uid)`. With the setting set it becomes
`[name](<base>/d/uid)`; empty or missing, only the name is shown, with no link
(#1844). Set it only to an address that opens on a phone away from home.

Nothing else about the run can be configured, on purpose:

- **HA endpoint:** always `ws://ha:8123/api/websocket`, reached over the
  `automation` network.
- **Desired state:** always the repo's `config/home-assistant/provision.json`.
- **Token:** always read from `/run/secrets/ha_provision_token`.

## Tests

```bash
node --test scripts/ha-provision/lib.test.mjs
```

CI runs them in `deployment-scripts-tests.yml` on the same Node image the
script runs with.
