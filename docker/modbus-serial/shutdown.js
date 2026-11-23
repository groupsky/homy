// Stops the service in order: stop polling, flush every integration that can
// be flushed, then exit. A stuck integration must not block the stop, so the
// flush is cut off after msTimeout. Keep msTimeout well under the 10 s that
// `docker stop` waits before it kills the process. A read in progress can wait
// for a reconnect for up to a minute, so stopPolling is waited for only
// msReadTimeout: the points already in the batch must still be sent.
module.exports = ({
  integrations,
  stopPolling,
  exit = process.exit,
  log = console.error,
  msTimeout = 5000,
  msReadTimeout = 2000,
}) => {
  let stopping = null

  return (reason) => {
    stopping = stopping || (async () => {
      log(`Received ${reason}, flushing and exiting`)
      let code = 0
      let timer
      try {
        // stopPolling may return a promise that settles when the reads in
        // progress are published, so their points are in the batch before it
        // is flushed. It is waited for only msReadTimeout.
        const flush = (async () => {
          let readTimer
          try {
            await Promise.race([
              stopPolling(),
              new Promise((resolve) => {
                readTimer = setTimeout(() => {
                  log(`Reads in progress took more than ${msReadTimeout} ms, flushing anyway`)
                  resolve()
                }, msReadTimeout)
              }),
            ])
          } catch (e) {
            log('Error stopping the poll', e)
          } finally {
            clearTimeout(readTimer)
          }
          await Promise.all(
            integrations
              .filter(({client}) => typeof client.close === 'function')
              .map(async ({client, name}) => {
                try {
                  await client.close()
                } catch (e) {
                  code = 1
                  log(`Error closing ${name}`, e)
                }
              })
          )
        })()
        const timeout = new Promise((resolve) => {
          timer = setTimeout(() => {
            code = 1
            log(`Closing the integrations took more than ${msTimeout} ms, exiting anyway`)
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
