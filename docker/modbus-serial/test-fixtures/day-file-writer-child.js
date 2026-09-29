#!/usr/bin/env node
/*
 * Test harness for day-file-writer.test.js: a real process that writes through
 * the real writer, so the test can exit or kill -9 it and inspect the file.
 *
 * Takes one JSON argument:
 *   root, stream, service  passed to createDayFileWriter
 *   timestamp              epoch ms stamped on every line (picks the day file)
 *   run                    written into every line, to tell runs apart
 *   count                  lines to write, then process.exit(); -1 writes until killed
 *   pad                    characters of padding per line (default 16)
 *   tear                   after `count` lines, write the first half of one
 *                          more line and SIGKILL itself before finishing it —
 *                          a crash in the middle of a line, made deterministic
 *
 * Prints "ready" on stdout once the first line is written.
 */
const fs = require('fs')
const {createDayFileWriter} = require('../day-file-writer')

const {root, stream, service, timestamp, run, count, pad = 16, tear = false} = JSON.parse(process.argv[2])
const padding = 'x'.repeat(pad)
const writer = createDayFileWriter({root, stream, service})

let file
for (let seq = 0; count < 0 || seq < count; seq++) {
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
