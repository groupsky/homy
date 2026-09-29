/**
 * Appends JSON values, one per line, to daily NDJSON files:
 *
 *     <root>/<stream>/<YYYY-MM-DD>.<service>.ndjson
 *
 * The day is the UTC calendar day of the timestamp given with each value.
 * `service` is the compose service name, so two services writing the same
 * stream (`monitoring` and `solar` both write `monitoring`) never share a file:
 * each file has exactly one writer. See issue #1622.
 *
 * How it writes, and why:
 *
 * - One file descriptor per day, opened with flag 'a' and kept open; a value
 *   stamped with another day closes it and opens that day's file. At UTC
 *   midnight that moves the writer to the new day.
 * - `fs.writeSync` per line. Not `fs.createWriteStream`: its writes are queued
 *   in memory, and the services call `process.exit()`, which drops the queue.
 *   Not `fs.appendFile`: concurrent calls can complete out of order. When
 *   `write` returns, the line is in the kernel and survives the process.
 * - Opening a file whose last byte is not '\n' writes '\n' first. A process
 *   killed half way through a line leaves it cut short; without this the next
 *   line would be glued onto it and both would be lost to a JSON parser. The
 *   same happens after a failed write (a full disk): the file is closed and the
 *   next write reopens it and repairs the end.
 *
 * The writer never deletes, rotates or compresses anything; a host-side job
 * owns finished days. The repair above only runs when a file is opened, so a
 * line cut short just before the day ends stays cut: a finished day's file can
 * end with one partial line without '\n', and a reader must skip it.
 *
 * This file is copied, unchanged, into every service that writes these files
 * (`docker/modbus-serial`, `docker/mqtt-ndjson`). They are separate npm
 * packages with separate `node_modules`, so it cannot be shared by `require`;
 * keep the copies identical, together with `day-file-writer.test.js` and
 * `test-fixtures/day-file-writer-child.js`.
 */
const fs = require('fs')
const path = require('path')

const NEWLINE = 0x0a

// A stream or service name becomes one path segment: no separators, no dot
// segments, nothing that could climb out of `root`.
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

/**
 * The UTC calendar day ('YYYY-MM-DD') of an epoch-milliseconds timestamp, or
 * `null` when it is not a number that names a day in years 0000-9999.
 */
function utcDay(epochMs) {
  if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return null
  const date = new Date(epochMs)
  if (Number.isNaN(date.getTime())) return null
  const day = date.toISOString().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

function requireSegment(value, what) {
  if (typeof value !== 'string' || !SEGMENT.test(value)) {
    throw new Error(`day-file-writer: ${what} must be a plain file name, got ${JSON.stringify(value)}`)
  }
}

// Writes all of `buffer`, looping over short writes.
function writeFully(fd, buffer) {
  let offset = 0
  while (offset < buffer.length) {
    offset += fs.writeSync(fd, buffer, offset, buffer.length - offset)
  }
}

function endsWithNewline(file, size) {
  const fd = fs.openSync(file, 'r')
  try {
    const last = Buffer.alloc(1)
    fs.readSync(fd, last, 0, 1, size - 1)
    return last[0] === NEWLINE
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * @param {object} options
 * @param {string} options.root    directory holding one subdirectory per stream
 * @param {string} options.stream  subdirectory name, e.g. the Mongo collection name
 * @param {string} options.service compose service name, part of the file name
 * @returns {{write: (value: object, epochMs: number) => string, close: () => void, ensureWritable: () => void}}
 */
function createDayFileWriter({root, stream, service}) {
  if (typeof root !== 'string' || root === '') {
    throw new Error(`day-file-writer: root must be a directory path, got ${JSON.stringify(root)}`)
  }
  requireSegment(stream, 'stream')
  requireSegment(service, 'service')
  const dir = path.join(root, stream)

  let openDay = null
  let fd = null
  let file = null

  function close() {
    if (fd === null) return
    try {
      fs.closeSync(fd)
    } catch (err) {
      // Nothing left to do with a descriptor that will not close.
    }
    fd = null
    openDay = null
    file = null
  }

  function open(day) {
    fs.mkdirSync(dir, {recursive: true})
    const dayFile = path.join(dir, `${day}.${service}.ndjson`)
    const dayFd = fs.openSync(dayFile, 'a')
    try {
      const {size} = fs.fstatSync(dayFd)
      if (size > 0 && !endsWithNewline(dayFile, size)) {
        writeFully(dayFd, Buffer.from('\n'))
      }
    } catch (err) {
      fs.closeSync(dayFd)
      throw err
    }
    fd = dayFd
    openDay = day
    file = dayFile
  }

  /**
   * Creates the stream directory if needed and throws unless this process can
   * write to it. Services call it once at startup, so a raw directory that
   * docker created as root (or a read-only mount) stops the service right
   * away, where the deploy gate and the restart loop show it, instead of
   * every later write failing.
   */
  function ensureWritable() {
    fs.mkdirSync(dir, {recursive: true})
    fs.accessSync(dir, fs.constants.W_OK)
  }

  /**
   * Appends `value` as one line to the file of `epochMs`'s UTC day and returns
   * that file's path. Throws, before touching any file, if the timestamp names
   * no day or the value has no JSON form; throws after closing the file if the
   * write itself fails.
   */
  function write(value, epochMs) {
    const day = utcDay(epochMs)
    if (day === null) {
      throw new TypeError(`day-file-writer: timestamp must be epoch milliseconds, got ${JSON.stringify(epochMs)}`)
    }
    const json = JSON.stringify(value)
    if (typeof json !== 'string') {
      throw new TypeError(`day-file-writer: value has no JSON form (${typeof value})`)
    }
    const line = Buffer.from(json + '\n')

    if (day !== openDay) {
      close()
      open(day)
    }
    try {
      writeFully(fd, line)
    } catch (err) {
      close()
      throw err
    }
    return file
  }

  return {write, close, ensureWritable}
}

module.exports = {createDayFileWriter, utcDay}
