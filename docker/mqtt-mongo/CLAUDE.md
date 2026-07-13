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

## Retention — one-time TTL index (mqtt-mongo-ioniq)

The Ioniq raw archive is capped at 90 days. Create the TTL index once against the
Mongo database (`MONGO_DATABASE`, default `power`). Mongo silently ignores
re-creation of an identical index, so this is safe to re-run:

    docker compose exec -T mongo mongosh \
      "mongodb://localhost:27017/${MONGO_DATABASE:-power}?authSource=admin" \
      -u "$(cat secrets/mongo_root_username)" -p "$(cat secrets/mongo_root_password)" \
      --eval 'db.ioniq.createIndex({ _ts: 1 }, { expireAfterSeconds: 7776000, name: "ttl__ts" })'

Verify:

    ... --eval 'db.ioniq.getIndexes()'

`expireAfterSeconds: 7776000` = 90 days. TTL uses ingest time (`_ts`); event time
stays in `payload.ts`. InfluxDB (`homy.ioniq`) is the long-term compact store and is
kept indefinitely.

## Testing

Unit tests cover `record.js#buildRecord` (Jest, minimal mocking):

    npm test

Run from `docker/mqtt-mongo/`. Jest is a devDependency only; the runtime image
installs with `npm ci --omit=dev`, so it is not shipped.
