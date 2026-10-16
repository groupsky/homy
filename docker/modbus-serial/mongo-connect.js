/**
 * Connects to MongoDB, retrying the first connect until it works.
 *
 * At boot a reader can start before Mongo accepts connections. One failed
 * connect used to stop its Mongo writes until the next restart (#1709). After
 * the first connect the driver reconnects by itself.
 *
 * This is a copy of `docker/ya-modbus-adapter/mongo-connect.js`. The two
 * services are separate npm packages, so the module cannot be shared by
 * `require`; keep them the same.
 */
const RETRY_MS = 10 * 1000

const connectWithRetry = ({connect, retryMs = RETRY_MS}) => new Promise((resolve) => {
  const attempt = () => connect().then(resolve, (err) => {
    console.error(`Error initializing mongo connection, retrying in ${retryMs / 1000} s:`, err.message)
    setTimeout(attempt, retryMs)
  })
  attempt()
})

module.exports = {connectWithRetry}
