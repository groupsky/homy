# CLAUDE.md - MQTT-Mongo Archive Service

This file provides guidance specific to the mqtt-mongo service for Claude Code.

## Service Overview

`mqtt-mongo` subscribes to an MQTT topic and stores every message verbatim in a
MongoDB collection as `{ topic, payload }`. It is a lossless archive used for
replay and ad-hoc queries. Multiple instances archive different topic trees.

### Service Instances
- **mqtt-mongo-history**: legacy temperature history (`/homy/br1/temp` → `history`).
- **mqtt-mongo-ioniq**: full Hyundai Ioniq OBD stream (`ioniq/#` → `ioniq`), covering
  parsed, raw, and status channels for replay / reverse-engineering.

## Record shape and timestamps

Each inserted document is `{ topic, payload }`. `record.js#buildRecord` enriches the
payload with two ingest timestamps when absent:

- `_tz` — epoch-ms **number** (historical field, kept for existing consumers).
- `_ts` — the same instant as a BSON **`Date`**. A MongoDB TTL index can expire only
  on a `Date` field, so `_ts` is what makes retention possible.

The logger's own event time remains available in `payload.ts`.

## Retention — automatic TTL index

Retention is opt-in via the `TTL_EXPIRE_SECONDS` environment variable. When set to
a positive integer, the service ensures a TTL index at startup (idempotent, re-run
safe on every reconnect); when unset, the archive is kept indefinitely (this is how
`mqtt-mongo-history` behaves). The Ioniq archive sets `TTL_EXPIRE_SECONDS=7776000`
(90 days) in `docker-compose.yml`.

**The index is created on `payload._ts`, not top-level `_ts`.** Because every
document is stored as `{ topic, payload }`, the BSON `Date` that `record.js` stamps
lives at `payload._ts`. A TTL index on top-level `_ts` matches no document and
Mongo never expires anything — this was a real production bug. `ttl.js` derives the
index path from `record.js`'s `TS_FIELD` constant so the two cannot drift, and
`__tests__/ttl.test.js` guards the alignment. TTL uses ingest time (`payload._ts`);
the logger's event time stays in `payload.ts`. InfluxDB (`homy.ioniq`) is the
long-term compact store and is kept indefinitely.

Verify the index after deploy:

    docker compose exec -T mongo mongosh \
      "mongodb://localhost:27017/${MONGO_DATABASE:-power}?authSource=admin" \
      -u "$(cat secrets/mongo_root_username)" -p "$(cat secrets/mongo_root_password)" \
      --eval 'db.ioniq.getIndexes()'

You should see `ttl_payload__ts` on `{ "payload._ts": 1 }` with
`expireAfterSeconds: 7776000`.

**One-time cleanup of the stale index:** production created a broken
`ttl__ts` index on top-level `{ _ts: 1 }` (never expired anything). After deploying
this fix, drop it:

    ... --eval 'db.ioniq.dropIndex("ttl__ts")'

**Changing the retention period later:** the index name is fixed, so re-running
`createIndex` with a different `TTL_EXPIRE_SECONDS` throws `IndexOptionsConflict`
(MongoDB does not update a TTL via `createIndex`) and the service logs it and
carries on with the *old* period. To actually change retention, update the value
in place with `collMod`:

    ... --eval 'db.runCommand({ collMod: "ioniq", index: { name: "ttl_payload__ts", expireAfterSeconds: <new> } })'

(or drop `ttl_payload__ts` and let the service recreate it on next restart).

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

**Retention caveat.** `mqtt-mongo-ioniq` sets `TTL_EXPIRE_SECONDS=7776000`, so
wrapped documents expire with everything else. `mqtt-mongo-history` sets no TTL at
all, so a persistently malformed publisher on `/homy/br1/temp` — which previously
crash-looped the archiver, making the problem loud — now accumulates up to 64 KiB
per message indefinitely. That is the deliberate cost of not dropping; watch the
`history` collection size if a producer there starts misbehaving.

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
