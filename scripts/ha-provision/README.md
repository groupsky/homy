# ha-provision

Applies [`config/home-assistant/provision.json`](../../config/home-assistant/provision.json)
to the running Home Assistant. It covers what HA keeps only in `.storage` and
cannot take from YAML:

- **Entity exposure to assistants** (`exposure`). For example, Assist
  (`conversation`) must never be able to switch `switch.1217_mariboli`.
- **Rows of storage-mode dashboards** (`dashboards.<url_path>.rows`). Each
  desired row replaces the row for the same entity on any `entities` card, in
  place. The rest of the dashboard stays editable in the UI.

A rebuilt data volume, or a row edited in the UI, reverts both. Re-run the
script to restore them. It is idempotent.

## Safety checks

The script refuses to save, and exits `1`, in two cases:

- **A desired entity is on no `entities` card.** The script does not decide
  where a control goes. Add the row in the UI, then re-run.
- **The entity also appears somewhere a row's `tap_action.confirmation` does
  not cover**, such as a tile card or a glance card. A default toggle row, a
  tile's icon and the more-info dialog all switch the entity without asking.

Every replaced row is printed before and after, so the run's own output is the
rollback.

## Running it on routy

It needs a long-lived access token of an **admin** user. The token is created
in HA under Profile → Security. Store it as `ha_provision_token` in the secrets
directory (`SECRETS_PATH`); see [`secrets/ha_provision_token`](../../secrets/ha_provision_token).

Run from the checkout, dry run first:

```bash
docker run --rm --network homy_automation \
  -v "$PWD":/w:ro \
  -v "$(realpath "${SECRETS_PATH:-./secrets}")/ha_provision_token":/run/secrets/ha_token:ro \
  -e HA_TOKEN_FILE=/run/secrets/ha_token \
  ghcr.io/groupsky/homy/node:22.22.0-alpine3.23 \
  node /w/scripts/ha-provision/index.mjs --dry-run
```

Drop `--dry-run` to apply. No container is restarted; HA applies both changes
live.

| variable | default | meaning |
|---|---|---|
| `HA_TOKEN` / `HA_TOKEN_FILE` | none | access token, or the file holding it |
| `HA_WS_URL` | `ws://ha:8123/api/websocket` | HA websocket, reached over the `automation` network |

`--desired=<file>` reads a different desired-state file.

## Tests

```bash
node --test scripts/ha-provision/lib.test.mjs
```

CI runs them in `deployment-scripts-tests.yml` on the same Node image the
script runs with.
