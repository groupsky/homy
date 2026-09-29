# CLAUDE.md - MQTT-Mongo Archive Service

This file provides guidance specific to the mqtt-mongo service for Claude Code.

## Service Overview

`mqtt-mongo` subscribes to an MQTT topic and stores every message verbatim in a
MongoDB collection as `{ topic, payload }`. It is a lossless archive used for
replay and ad-hoc queries. Multiple instances archive different topic trees.

### Service Instances
- **mqtt-mongo-ioniq**: full Hyundai Ioniq OBD stream (`ioniq/#` → `ioniq`), covering
  parsed, raw, and status channels for replay / reverse-engineering.

`mqtt-mongo-history` (legacy temperature history, `/homy/br1/temp` → `history`)
was removed in #1619. Its only publisher was a Node-RED flow polling a Broadlink
RM+ device's temperature sensor; the flow ran unedited from 2021-01-21 until
Node-RED was fully removed from the stack on 2026-01-25 (#1185), but the
device or its host stopped actually publishing on 2024-07-04 — 18 months
earlier, and unexplained by anything in this repo's history. The
`history` collection (3.4M documents, 2021-01-21 to 2024-07-04) is not
deleted by this issue; it is handled like every other MongoDB collection
(see Retention, below).

## Record shape and timestamps

Each inserted document is `{ topic, payload }`. `record.js#buildRecord` enriches the
payload with two ingest timestamps when absent:

- `_tz` — epoch-ms **number** (historical field, kept for existing consumers).
- `_ts` — the same instant as a BSON **`Date`**. A MongoDB TTL index can expire only
  on a `Date` field, so `_ts` is what makes retention possible.

The logger's own event time remains available in `payload.ts`.

## Retention

**MongoDB is being retired (#1622).** Nothing in this repo reads it
automatically; it was only ever a raw record of every reading. Raw readings
now also go to **daily NDJSON files** under `RAW_DATA_PATH`:
`docker/mqtt-ndjson` (`mqtt-ndjson-ioniq`) writes what this service writes
for `ioniq/#`, and `modbus-serial`'s `ndjson` integration writes what it puts
in its MongoDB collections. A host-side job turns finished days into Parquet
and archives them; a consumer that needs the history reads that archive
(with DuckDB, for example).

A line goes to the file of the UTC day of its `payload._tz`, with one
deliberate exception in `mqtt-ndjson` that narrows #1622's literal rule "day =
the UTC day of `_tz`": a `_tz` the *producer* stamped picks the file only when
it is epoch milliseconds within 36 hours of the arrival time; otherwise the
file is picked by the arrival time (the record keeps the producer's `_tz`). So
when the overlap compares this collection with the NDJSON files by `_tz`, a
document with a far-off or malformed producer `_tz` is in the file of the day
it arrived. See `docker/mqtt-ndjson/CLAUDE.md`.

The switch happens in steps, all tracked in #1622:

1. **Overlap** (starts with the deploy of #1622's writers): MongoDB and the NDJSON files are written
   side by side for at least 7 days, and their contents are compared.
2. **Cut-over**: the `mongodb` integration is removed from every
   `modbus-serial` config, and this service is removed.
3. **Switch-off**: once the host side has exported the existing MongoDB
   history, `mongo`, `mongo-express` and everything else that uses MongoDB is
   removed. The MongoDB data directory is kept until the owner decides.

Until the switch-off, nothing in this repo deletes from MongoDB, and
`historian` only replays what MongoDB still holds.

MongoDB is **not** cleaned with a TTL index: a TTL index deletes on its own
schedule, so it could delete data before the host-side job has exported it.
`ioniq` had a 90-day TTL index (`TTL_EXPIRE_SECONDS`, below) until #1618
dropped it and removed the setting, for exactly that reason.

### The TTL_EXPIRE_SECONDS code (unused; do not set it)

The code still supports an opt-in TTL index via the `TTL_EXPIRE_SECONDS`
environment variable (`ttl.js`). No instance sets it, and none should while
MongoDB is being retired (see Retention, above): it would delete data before
the host-side job has exported it. The code goes away with this service at the
#1622 cut-over.

For reading the code: when set, the index is created on `payload._ts`, not
top-level `_ts`, because every document is stored as `{ topic, payload }`. A
TTL index on top-level `_ts` matches no document — this was a real production
bug. `ttl.js` derives the path from `record.js`'s `TS_FIELD` constant, and
`__tests__/ttl.test.js` guards the alignment.

## Malformed Payload Handling

The message listener in `archive.js` is `async`, so anything thrown inside it
becomes a rejected promise that `EventEmitter.emit` discards — and the Dockerfile
sets `NODE_OPTIONS="--unhandled-rejections=strict"`, which turns that into an
uncaught exception and exit 1. With `restart: unless-stopped` and a retained bad
payload, that is a crash loop. `mqtt-mongo-ioniq` subscribes to `ioniq/#`, so any
producer anywhere under that tree could take the archiver down and stop every
topic's history, not just the offending one. Issue #1526 was exactly that, a bare
`JSON.parse` in `buildRecord`.

**An unparseable payload is archived raw, not dropped.** This archive is the only
record of the topics it covers, so discarding a message would be real data loss —
and a payload that fails to parse is often the one worth keeping. `buildRecord`
wraps it instead of throwing:

```js
{ topic, payload: { _raw: '<payload as it arrived>', _parseError: '<reason>', _tz, _ts } }
```

The wrapper is a plain object stamped with the usual `_ts`/`_tz`, so retention
still applies to it — a bare string would not be TTL-eligible, since the TTL
index expires on `payload._ts`.

The same wrapper is used for a payload that *is* valid JSON but cannot carry the
timestamps: `null`, a scalar, or an array. Assigning `_ts` to a scalar is a silent
no-op and properties set on an array do not survive BSON serialization, so a
document built from one would never expire — the same class of bug as the
top-level-`_ts` index described above. `_parseError` then reads
`payload is not a JSON object (<typeof>)`.

`_raw` is bounded at 65536 characters (`RAW_LENGTH`), with the truncation marked
in-band as `... (N chars)`. The bound exists so an oversized publish cannot push
the document past MongoDB's 16 MB limit: `insertOne` failing is fatal by design
(the container restarts and retries), which would reintroduce the crash the guard
removes.

`buildRecord` returns `{ record, error }` — the document to insert, and `null` or
the reason it had to be wrapped. **The archiver decides from that flag, never from
a field on the document.** `_raw` and `_parseError` are ordinary JSON keys, so a
publisher can send them inside a perfectly valid payload; a caller that
distinguished on them would report a parse failure that never happened. For the
same reason a *consumer* of this archive cannot treat those fields as proof that a
document was wrapped — only that the producer or the archiver put them there.

`archive.js` also calls `buildRecord` inside a `try`. `buildRecord` is written not
to throw, but nothing enforces that invariant, and this listener is `async` — so
the backstop makes the no-crash guarantee structural rather than an argument about
the current implementation. If it ever fires, the message is dropped (one message
lost beats losing the archiver) and logged as `Failed to build record for topic
<topic> "<preview>" <error>`.

`archive.js` logs `Failed to parse payload for topic <topic> "<preview>" <reason>
- archiving raw`. The preview comes from `payload-preview.js`, at most the first
100 characters with `... (N chars)` appended, so a chatty broken publisher cannot
flood the log. That module is a copy of
`docker/automations/lib/payload-preview.js` — the services are separate npm
packages with separate `node_modules`, so it cannot be shared by `require`; the
behaviour and its test suite are kept identical.

A consumer reading this archive must expect `_raw`/`_parseError` documents
alongside normal ones and skip or handle them.

**Retention caveat.** No instance sets a TTL index (see Retention above): a
persistently malformed publisher accumulates up to 64 KiB per message, and
nothing deletes it before MongoDB is switched off. That is the deliberate
cost of not dropping; watch a collection's size if a producer starts
misbehaving.

Separately, and pre-existing: an incoming payload that already carries `_ts` keeps
it (see `buildRecord`), so a producer sending a *string* `_ts` still yields a
document the TTL index cannot expire. The wrapper argument above only covers
payloads this service stamps itself.

## Testing

Unit tests cover `record.js#buildRecord`, `archive.js#startArchiving`, the TTL
index arguments and `payload-preview.js` (Jest, minimal mocking — the MQTT client
is a plain `EventEmitter` and the Mongo collection a small fake):

    npm ci
    npm test

Run from `docker/mqtt-mongo/`. Jest is a devDependency only; the runtime image
installs with `npm ci --omit=dev`, so it is not shipped.

`.github/workflows/test-mqtt-mongo.yml` runs the suite on every change under
`docker/mqtt-mongo/`.
