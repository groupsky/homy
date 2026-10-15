# Modbus buses on ya-modbus

The old Modbus reader is `modbus-serial`: one service per RS-485 bus. It is
being replaced, one bus at a time, by the ya-modbus MQTT bridge
([`@ya-modbus/mqtt-bridge`](https://github.com/groupsky/ya-modbus)). A bus
moves only when ya-modbus gives the same or a higher rate and the same
completeness for every device on it (ya-modbus#600).

Buses on ya-modbus today:

| bus | port holder (bridge) | adapter | bridge config | since |
|---|---|---|---|---|
| `tetriary` | `tetriary-power` | `tetriary-adapter` | `config/ya-modbus/tetriary.json` | #1707 |

## How a moved bus works

```
serial port ── bridge (<bus>-power) ── ya-modbus/<device>/data ── adapter (<bus>-adapter) ──┬─ MQTT /modbus/<bus>/<device>/reading
                                                                                            ├─ NDJSON day file
                                                                                            └─ MongoDB collection (until #1622)
```

- **Bridge** (`docker/ya-modbus-bridge`): the bridge and its drivers, with
  pinned versions, on Node 22. Its config is a JSON file in
  `config/ya-modbus/`. It publishes `ya-modbus/<deviceId>/data` with
  `{deviceId, timestamp, data}`. The prefix `ya-modbus` cannot conflict with
  `/modbus`.
- **Adapter** (`docker/ya-modbus-adapter`): turns each data message back into
  the old reader's reading, so no consumer changes (Home Assistant, the
  automations, `mqtt-influx`, the raw archive). It reads the same bridge
  config file for the devices, their addresses and drivers.

The reading of the adapter is the old reading with two differences:

- No `_ms` (the read time): the bridge does not publish it (ya-modbus#617).
  Nothing that reads these buses uses it.
- `_tz` is the bridge's `timestamp`, the end of the read. The old `_tz` was
  the middle of the read, so the new one is about 0.2 s later.

The NDJSON file name has the adapter's service name:
`<RAW_DATA_PATH>/<stream>/<day>.<bus>-adapter.ndjson`. The stream and the
Mongo collection stay the same.

**Why the bridge keeps the old service name.** Two readers on one serial port
corrupt each other's reads. The service that holds the port keeps the name
`<bus>-power`, whether it runs the old reader or the bridge. So every change
of it replaces the container, and only one of them can run:

- a deploy that fails and rolls back puts the old reader back in the same
  container;
- the move back does the same.

The adapter is the new service. A deploy does not remove a service that is no
longer in `docker-compose.yml` (`docs/DEPLOYMENT.md`), so after a rollback or
the move back the adapter keeps running. That is harmless: without the bridge
it gets no messages and writes nothing. Remove it by hand when convenient
(see below).

`scripts/compose-serial-ports.test.mjs` checks that every serial port has
one reader, and which reader each moved bus has.

## Move a bus to ya-modbus

All in one PR:

1. `config/ya-modbus/<bus>.json`: the devices of the bus, with the port,
   serial settings and addresses from `config/modbus-serial/<bus>.config.js`.
   Use `"polling": {"interval": 1000, "mode": "continuous"}`.
2. A mapping for each new driver in `docker/ya-modbus-adapter/mappings/<type>.js`
   (old field → ya-modbus data point id), and a test with a real old reading.
   `<type>` is the driver package name without `@ya-modbus/driver-`.
3. Add the driver package to `docker/ya-modbus-bridge/package.json`.
4. In `docker-compose.yml`, change `<bus>-power` to the bridge, as
   `tetriary-power` is, and add `<bus>-adapter` with the old service's `TOPIC`,
   `COLLECTION` and Mongo settings.
5. In `scripts/compose-serial-ports.test.mjs`, expect the bridge on the
   bus's port.

Keep `config/modbus-serial/<bus>.config.js` and its `.env` variable: the move
back needs them.

## Move a bus back to the old reader

1. In `docker-compose.yml`, put back the `<bus>-power` block of the old
   reader. For `tetriary`, it is the block before #1707:

   ```bash
   git log --oneline -1 --grep='#1707' -- docker-compose.yml   # the move
   git show <that commit>^:docker-compose.yml                   # copy tetriary-power from here
   ```

   Remove the `<bus>-adapter` service.
2. In `scripts/compose-serial-ports.test.mjs`, expect `modbus-serial` on the
   bus's port.
3. Merge and deploy. The deploy replaces `<bus>-power`: the bridge stops and
   the old reader starts.
4. Remove the adapter container. Do not use `--remove-orphans`: it also
   removes the containers of other compose files in the same directory.

   ```bash
   docker rm -f homy-<bus>-adapter-1
   ```

The old reader writes its own file again (`<day>.<bus>-power.ndjson`).

## Checks after a move

Within 10 minutes after the deploy (replace `tetriary` and `heat_pump` for
another bus):

```bash
# MQTT: new readings, with the old fields
docker compose exec broker mosquitto_sub -t /modbus/tetriary/heat_pump/reading -C 3 -v
# The adapter and the bridge log no errors
docker compose logs --since 10m tetriary-power tetriary-adapter
# NDJSON: new lines in the adapter's file
tail -n 2 "$RAW_DATA_PATH/tetriary/$(date -u +%F).tetriary-adapter.ndjson"
```

Also check the new points in InfluxDB (`mqtt-influx` writes them from MQTT),
the Home Assistant sensors of the bus, and new documents in the Mongo
collection.

**`ndjson-overlap` on the day of a move.** The check reads only the files of
the writers in `docker-compose.yml`. On the day of a move (or a move back) it
does not read the other reader's file, so that reader's records of the day
show as "only in Mongo". Leave that day out, or compare it by hand.

## MongoDB

The adapter writes Mongo only while `MONGODB_URL` is set. At the #1622
cut-over, remove the `MONGODB_*` variables and the `mongo` secrets and
`depends_on` from the adapter services.
