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
  UI (Settings → Dashboards). Today: `dashboard-ioniq` (#1800).
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
  ghcr.io/groupsky/homy/node:22.22.0-alpine3.23 \
  node /w/scripts/ha-provision/index.mjs --dry-run
```

Drop `--dry-run` to apply. No container is restarted; HA applies all changes
live.

One setting comes from `.env`: `HA_GRAFANA_BASE_URL`, the base of the
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
