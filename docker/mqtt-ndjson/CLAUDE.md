# CLAUDE.md - MQTT-NDJSON Raw Archive Service

This file provides guidance specific to the mqtt-ndjson service for Claude Code.

## Service Overview

`mqtt-ndjson` subscribes to an MQTT topic and writes every message, as one
`{ topic, payload }` JSON line, to a daily file:

    <RAW_DIR>/<STREAM>/YYYY-MM-DD.<SERVICE_NAME>.ndjson

It is the successor of `docker/mqtt-mongo`: MongoDB is being retired (#1622).
Until the cut-over both run side by side and must hold the same messages. A
host-side job turns finished days into Parquet; this service only appends and
never compresses or deletes a file.

### Service Instances
- **mqtt-ndjson-ioniq**: full Hyundai Ioniq OBD stream (`ioniq/#` → stream
  `ioniq`), the same subscription as `mqtt-mongo-ioniq`.

## Configuration

| Variable | Meaning |
|---|---|
| `BROKER` | MQTT URL, `mqtt://broker` |
| `TOPIC` | subscription, e.g. `ioniq/#` |
| `MQTT_CLIENT_ID` | client id, the compose service name |
| `RAW_DIR` | where `${RAW_DATA_PATH}` is mounted (`/data/raw`) |
| `STREAM` | directory under `RAW_DIR`, e.g. `ioniq` |
| `SERVICE_NAME` | the compose service name, part of the file name |

A missing `BROKER`/`TOPIC`, or a missing or unsafe `RAW_DIR`/`STREAM`/
`SERVICE_NAME` (a path, `..`), stops the service at startup.

`RAW_DATA_PATH` must exist on the host and be owned by uid 1000, which the image
runs as (so do the `modbus-serial` images that write there too). If docker
creates it, it is owned by root and every write fails.

## Record shape and timestamps

`record.js#buildRecord` stamps the payload like `mqtt-mongo` does, when the
field is absent:

- `_tz` — epoch milliseconds.
- `_ts` — the same instant as an ISO 8601 UTC string (in MongoDB a BSON `Date`,
  which is the same string in JSON).

The line goes to the file of the **UTC** day of `payload._tz`. That is usually
the time this service received the message, but a producer may stamp `_tz`
itself (the automations bots publish `ioniq/derived/...` with one). If the
producer's `_tz` is not a number, the record is kept as sent and filed by the
time it arrived. A message stamped just before midnight but received just after
goes to the previous day's file, so the host-side job must leave a day alone for
a short while after it ends.

A payload that is not valid JSON, or is valid JSON but not an object, is kept
raw, not dropped — the same wrapper as `mqtt-mongo`:

```js
{ topic, payload: { _raw: '<payload as it arrived, at most 65536 chars>', _parseError: '<reason>', _tz, _ts } }
```

and logged as `Failed to parse payload for topic <topic> "<preview>" <reason> -
writing raw`, with a preview of at most 100 characters (`payload-preview.js`, a
copy of `docker/automations/lib/payload-preview.js`). `_raw` and `_parseError`
are ordinary JSON keys a producer can send too, so the log decides from what
`buildRecord` returns, never from the fields; a consumer cannot treat them as
proof that a record was wrapped.

## How it writes

`day-file-writer.js`, shared with `modbus-serial`'s `ndjson` integration:

- One file descriptor per day, opened with flag `'a'`; a record of another day
  closes it and opens that day's file.
- `fs.writeSync` per line, so a line is in the kernel when the call returns and
  survives `process.exit()`. Not `fs.createWriteStream` (queued writes are
  dropped on exit), not `fs.appendFile` (parallel calls finish out of order).
- Opening a file whose last byte is not `\n` writes `\n` first, so a line cut
  short by a crash (or a failed write) is never glued to the next one.

Nothing may throw out of the message listener: it runs inside the mqtt client's
stream, where an exception kills the process (issue #1526). A write failure is
logged and turned into an explicit `exit(1)`, as in `mqtt-mongo`, so the
container restarts and tries again.

The services are separate npm packages, so `day-file-writer.js` cannot be shared
by `require`: it, `day-file-writer.test.js` and
`test-fixtures/day-file-writer-child.js` are identical copies of the files in
`docker/modbus-serial`. Change them together.

## Testing

Jest, with minimal mocking: the MQTT client is a plain `EventEmitter`, the
writer is real and writes to a temporary directory. The crash test runs the
writer in a real child process, kills it with `SIGKILL` in the middle of a line,
restarts it and checks that no line is glued to another.

    npm ci
    npm test

Run from `docker/mqtt-ndjson/`. `.github/workflows/test-mqtt-ndjson.yml` runs
the suite on every change under `docker/mqtt-ndjson/`.
