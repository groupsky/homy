# ndjson-overlap

Checks phase 2 of #1622 (the overlap). While MongoDB and the daily NDJSON
files both get every reading, the NDJSON lines of a stream and UTC day must
**equal** the Mongo documents whose `_tz` is in that day. A difference is a
bug to fix before the cut-over, unless it has one of the known causes listed
under "What is compared".

For each stream and day, the script compares every record's content, not only
the counts. It prints a markdown table for the issue.

## Running it on routy

Run it from the checkout, as the deploy user. It needs `docker compose`
(v2), `jq`, and the running `mongo` service. It checks yesterday (UTC) by
default:

```bash
scripts/ndjson-overlap.sh                          # every stream, yesterday
scripts/ndjson-overlap.sh 2026-09-30 2026-10-01    # given UTC days
scripts/ndjson-overlap.sh --stream monitoring      # one stream
```

To build the 7-day table, run it once a day with the same results file. Each
run adds its days to the file and prints the table of every day in it:

```bash
scripts/ndjson-overlap.sh --results ~/ndjson-overlap.jsonl
```

Checking a day again replaces that day's row in the table. Keep the results
file on the host, because it holds sample readings (see below).

Exit status: `0` all equal, `1` some stream and day differ, `2` the check
itself failed (compose config, Mongo query, bad day). The table goes to
stdout, progress to stderr.

Nothing needs to be configured. Nothing is written except `--results` (or a
temporary file in its place). The node image may be pulled (see below).

- **Writers and streams** come from `docker compose config`. Every service
  with a `RAW_DIR` is a writer. Its stream is `STREAM` or `COLLECTION`, and
  its file name part is `SERVICE_NAME`. `monitoring` and `solar` both write the
  `monitoring` stream, so the two files of a day are counted together. The
  notes column shows each writer's share.
- **Raw directory**: the host side of the `RAW_DIR` bind mount. Compose has
  already resolved `RAW_DATA_PATH=${DATA_PATH}/raw` from `.env`. A day that
  the archive job has already gzipped (`.ndjson.gz`) is read too.
- **Mongo**: `docker compose exec -T mongo mongosh` against
  `$MONGO_INITDB_DATABASE`, with the root user from the container's secrets,
  as `backup_mongo` does. The Mongo collection is the stream name.
- **Node**: the host's `node` (18 or newer) if there is one. Otherwise the
  comparison runs in `ghcr.io/groupsky/homy/node:22.22.0-alpine3.23`, with no
  network and the raw directory mounted read-only. Set
  `NDJSON_OVERLAP_NODE_IMAGE` to use another image.

## What is compared

- **Mongo side**: the documents with `_tz` in the day (for `ioniq`:
  `payload._tz`) and an `_id` inside a margin around the day. The `_id` range
  lets the query use the `_id` index. `_id` itself is not compared.
  - modbus streams: 60 s before the day to 60 s after it. `modbus-serial`
    creates the `_id` within milliseconds of `_tz`.
  - `ioniq`: 36 hours before and after. The producer may stamp `_tz` itself,
    while the `_id` is the time the message arrived. `mqtt-ndjson` puts such a
    line in the file of the day of that `_tz` if it arrived within 36 hours
    (see `docker/mqtt-ndjson/CLAUDE.md`). A retained message sent again after
    a restart can arrive that late.
- **NDJSON side**: `<raw>/<stream>/<day>.<service>.ndjson` of every writer of
  the stream.
- **Equal** means the same records the same number of times, in any order,
  with any key order. Before comparing, the Mongo values are changed to what
  `JSON.stringify` writes:
  - a date becomes its ISO string,
  - `NaN` and `±Infinity` become `null`,
  - 64-bit integers become numbers,
  - keys whose value is `null` are ignored on both sides, because BSON stores
    an `undefined` field as `null` and JSON leaves it out.
- **`ioniq` (`{topic, payload}`)**: `payload._tz` and `payload._ts` are not
  compared. `mqtt-mongo-ioniq` and `mqtt-ndjson-ioniq` each receive the
  message and stamp the arrival time themselves, a few milliseconds apart.
  There are known causes of small `ioniq` differences that are not writer
  bugs:
  - a message that arrives within milliseconds of midnight can have its two
    stamps on different days;
  - one of the two services can miss messages while it restarts;
  - when a producer's own `_tz` is not trusted (see
    `docker/mqtt-ndjson/CLAUDE.md`), `mqtt-ndjson` puts the line in the file
    of the day it arrived, not the day of its `_tz`.
- **Modbus streams**: both writers get the same object in the same process,
  so any difference in content is a bug. A few missing records have known
  causes that are not bugs in the NDJSON writer:
  - "only in NDJSON" just after a `modbus-serial` service started: the
    `mongodb` integration drops readings until its connection to MongoDB is
    ready.
  - "only in NDJSON" just before a `modbus-serial` service stopped (for
    example a deploy or a crash): the Mongo insert is asynchronous and still
    in flight, while the NDJSON line is already written.
  - "only in NDJSON" for a failed Mongo insert, which the integration only
    logs ("Error logging entry").
  - "only in Mongo" for a failed NDJSON write, which the integration logs
    (`[ndjson] failed to write`) and skips.

  Check the service's log around the time of such records before calling them
  a bug.

## Reading the table

```
| stream | UTC day | Mongo | NDJSON | equal | notes |
|---|---|---:|---:|---|---|
| main | 2026-09-30 | 86211 | 86211 | yes |  |
| monitoring | 2026-09-30 | 120034 | 120033 | **no**: 1 only in Mongo, 0 only in NDJSON | monitoring 60020 + solar 60013; solar: last line cut short (skipped) |
```

- **only in Mongo / only in NDJSON**: records with no equal record on the
  other side. When the counts are equal and `equal` still says no, the
  content differs. For modbus streams, the lines below the table name the
  fields that differ. They look only at the first 20 differing records of each
  side, and pair them by `device` and `_tz`.
- **last line cut short (skipped)**: the file ends in a line without `\n` that
  is not JSON. This is a write that was cut off by a crash, after which the
  writer did not open that day's file again (for example, it restarted after
  midnight). The writer only repairs a file when it opens it again, so the cut
  line stays. It is not counted, and Mongo usually has that reading, so it
  shows up as "1 only in Mongo".
- **unreadable line(s)**: a line inside the file that is not a JSON object.
  This is a crash earlier in the day, which the writer repaired on restart.
- **both .ndjson and .ndjson.gz (both read)**: a line arrived after the
  archive job had gzipped the day, and the writer made a new plain file.
- **no file**: that writer wrote nothing that day. For example, `inverter`
  while its Modbus reads time out.
- **record(s) with _tz outside the day**: a line in the wrong day's file. For
  a modbus stream this is a writer bug. For `ioniq` it is a producer `_tz`
  that was not trusted (see above).
- **day not over yet**: the day, or its margin (60 s, or 36 hours for
  `ioniq`), has not ended, so the counts will still change.

`--samples` also prints up to 20 differing records from each side, to read on
the host only. **Never paste them into the issue.** `homy` is public, and raw
readings (for example `ioniq`'s) must not go there. The table without
`--samples` holds only counts and field names.

## Tests

```bash
node --test scripts/ndjson-overlap/lib.test.mjs scripts/ndjson-overlap/cli.test.mjs
node --test scripts/ndjson-overlap/mongo.test.mjs   # needs docker
cd scripts/tests && ./bats-core/bin/bats ndjson-overlap.bats
```

`mongo.test.mjs` starts a throwaway MongoDB from the image in
`docker/mongo/Dockerfile`, and runs the real query through real `mongosh`. It
is skipped when docker is not available. CI runs all of them in
`deployment-scripts-tests.yml`.
