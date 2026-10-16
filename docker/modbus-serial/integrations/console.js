/**
 * Prints each reading to stdout. `MODBUS_CONSOLE` sets how much:
 *
 * - `off` (default): nothing. Read and write errors are still logged by the reader.
 * - `line`: one line per reading, the object as JSON.
 * - `full`: the whole object, one field per line.
 *
 * `full` for every reading of every reader was about 98 % of all log lines on
 * the host and pushed the useful lines out of `docker logs`, so it is opt-in.
 */
const MODES = ['off', 'line', 'full']

const setup = () => {
  let mode = process.env.MODBUS_CONSOLE || 'off'
  if (!MODES.includes(mode)) {
    console.error(`MODBUS_CONSOLE must be one of ${MODES.join(', ')}, not "${mode}"; logging nothing`)
    mode = 'off'
  }
  const logger = {
    off: () => {},
    line: (entry, device) => console.log(`[${device.name}]: ${JSON.stringify(entry)}`),
    full: (entry, device) => console.log(`[${device.name}]:`, entry),
  }[mode]
  logger.toString = () => 'console'
  return { publish: logger }
}

module.exports = setup
