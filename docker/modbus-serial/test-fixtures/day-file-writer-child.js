#!/usr/bin/env node
/*
 * Test harness for day-file-writer.test.js: a real process that writes through
 * the real writer, so the test can exit or kill -9 it and inspect the file.
 *
 * Takes one JSON argument:
 *   root, stream, service  passed to createDayFileWriter
 *   timestamp              epoch ms stamped on every line (picks the day file)
 *   run                    written into every line, to tell runs apart
 *   count                  lines to write, then process.exit(); -1 writes until
 *                          killed. Bounded (0 to 1000000) otherwise
 *   pad                    characters of padding per line (default 16, max 16 MiB)
 *   tear                   after `count` lines, write the first half of one
 *                          more line and SIGKILL itself before finishing it —
 *                          a crash in the middle of a line, made deterministic
 *
 * Prints "ready" on stdout once the first line is written.
 */
const fs = require('fs')
const {createDayFileWriter} = require('../day-file-writer')

const {root, stream, service, timestamp, run, count, pad = 16, tear = false} = JSON.parse(process.argv[2])

// This process only ever runs with an argument the test suite itself builds
// (see day-file-writer.test.js), never external input — but bounding it here
// keeps that true structurally, not just by convention.
const MAX_PAD = 16 * 1024 * 1024 // 16 MiB: comfortably above the 256 KiB the crash test uses for large lines
const MAX_COUNT = 1000000
if (!Number.isInteger(pad) || pad < 0 || pad > MAX_PAD) {
  throw new RangeError(`pad must be an integer in [0, ${MAX_PAD}], got ${JSON.stringify(pad)}`)
}
if (count !== -1 && (!Number.isInteger(count) || count < 0 || count > MAX_COUNT)) {
  throw new RangeError(`count must be -1 (run until killed) or an integer in [0, ${MAX_COUNT}], got ${JSON.stringify(count)}`)
}

const padding = 'x'.repeat(pad)
const writer = createDayFileWriter({root, stream, service})
const runForever = count === -1

let file
for (let seq = 0; runForever || seq < count; seq++) {
  file = writer.write({run, seq, pad: padding}, timestamp)
  if (seq === 0) process.stdout.write('ready\n')
}

if (tear) {
  const line = JSON.stringify({run, seq: count, pad: padding}) + '\n'
  const fd = fs.openSync(file, 'a')
  fs.writeSync(fd, line.slice(0, Math.floor(line.length / 2)))
  process.kill(process.pid, 'SIGKILL')
}

process.exit(0)
