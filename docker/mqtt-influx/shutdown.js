// Stops the service in order: stop taking messages, flush every InfluxDB write
// API, then exit. The write API keeps points in a memory batch, so closing it
// is what sends them. A stuck InfluxDB must not block the stop, so the flush is
// cut off after msTimeout. Keep msTimeout well under the 10 s that
// `docker stop` waits before it kills the process.
module.exports = ({
  writeApis,
  stop = () => {},
  exit = process.exit,
  log = console.error,
  msTimeout = 5000,
}) => {
  let stopping = null

  return (reason) => {
    stopping = stopping || (async () => {
      log(`Received ${reason}, flushing and exiting`)
      let code = 0
      let timer
      try {
        const flush = (async () => {
          try {
            await stop()
          } catch (e) {
            log('Error stopping the input', e)
          }
          await Promise.all(writeApis.map(async (writeApi) => {
            try {
              await writeApi.close()
            } catch (e) {
              code = 1
              log('Error closing the InfluxDB write API', e)
            }
          }))
        })()
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            code = 1
            log(`Closing InfluxDB took more than ${msTimeout} ms, exiting anyway`)
            resolve()
          }, msTimeout)
        })
        await Promise.race([flush, timeout])
      } catch (e) {
        code = 1
        log('Error while stopping', e)
      } finally {
        clearTimeout(timer)
      }
      exit(code)
    })()
    return stopping
  }
}
