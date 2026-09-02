# CLAUDE.md - DMX Driver Service

This file provides guidance specific to the dmx-driver service for Claude Code.

## Service Overview

`dmx-driver` drives a DMX lighting universe from a dry-switch reading published
on MQTT. It subscribes to a single topic (`TOPIC`, in production
`/modbus/dry-switches/mbsl32di1/reading`) and writes three DMX channels from the
`inputs` bit field in that reading.

It talks to an Enttec Open USB DMX interface through the `dmx` package, a native
addon built against libftdi. The container is `privileged` and mounts
`/dev/bus/usb`.

## Layout

| file | role |
|---|---|
| `index.js` | client wiring: MQTT connection, subscription, DMX universe lifecycle |
| `message-handler.js` | the `message` listener — payload → channel levels |
| `payload-preview.js` | bounded, never-throwing payload rendering for logs |

The listener lives in its own module so it can be tested without a broker or a
USB DMX interface: `message-handler.js` does not `require('dmx')`, it takes the
universe as an argument.

## Channel mapping

The reading is a single `inputs` bit field produced by the `mbsl32di` driver in
`modbus-serial`. Bits 32, 512 and 2048 map to DMX channels 1, 2 and 3; a closed
input drives its channel to level 128. Channel state is kept across messages, so
a message that cannot be used leaves the lights as they were.

## Malformed Payload Handling

The `message` listener runs inside the MQTT client's stream: `handlePublish`
emits `message` from `writable._write`. An exception escaping the listener
therefore surfaces as an unhandled `error` event on that stream. This service's
own `client.on('error')` handler calls `process.exit(1)`, and the service is
`restart: unless-stopped` — so if the malformed payload was published with
`retain`, the broker redelivers it on reconnect and the service crash-loops.
Issue #1526 was exactly that, a bare `JSON.parse`.

What the handler guarantees:

- **A payload that is not valid JSON is dropped, not fatal.** It logs
  `Failed to parse payload for topic <topic> "<preview>" <error>` and returns.
- **Valid JSON that is not a usable reading is also dropped.** `null` has no
  properties to destructure, and an object without a numeric `inputs` would
  otherwise silently blank every channel — worse than ignoring the message. Both
  log `Ignoring payload without a numeric inputs field for topic <topic>
  "<preview>"` and return.
- **The universe is left untouched on a dropped message.** The previous frame
  stands; one bad publish does not reset the lights.
- **The log carries a bounded preview.** `payload-preview.js` renders at most
  the first 100 characters and appends `... (N chars)` when it truncates, so a
  chatty broken publisher cannot flood the log.

`payload-preview.js` is a copy of `docker/automations/lib/payload-preview.js`.
The services are separate npm packages with separate `node_modules`, so the
module cannot be shared by `require`; the behaviour and its test suite are kept
identical.

## Testing

    npm ci --ignore-scripts
    npm test

Run from `docker/dmx-driver/`. `--ignore-scripts` skips the node-gyp build of the
`dmx` native addon, which needs libftdi headers; the unit tests do not need it.
`.github/workflows/test-dmx-driver.yml` runs the same two commands on every
change under `docker/dmx-driver/`.

Jest is a devDependency only; the runtime image installs with `npm ci --omit=dev`,
so it is not shipped.

**Regenerate `package-lock.json` with node 18.20.8**, the version in `.nvmrc` and in
the Dockerfile's base image. A lockfile written by a newer npm resolves jest's
optional platform bindings differently, and npm 10.8.2 then rejects it with
`npm ci can only install packages when your package.json and package-lock.json are
in sync` / `Missing: @emnapi/core@... from lock file` — which breaks both the test
workflow and the image build.
