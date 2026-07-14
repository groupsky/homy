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

## Testing

Unit tests cover `record.js#buildRecord` (Jest, minimal mocking):

    npm test

Run from `docker/mqtt-mongo/`. Jest is a devDependency only; the runtime image
installs with `npm ci --omit=dev`, so it is not shipped.
