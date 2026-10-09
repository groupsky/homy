// A timeout or a CRC error most often means one frame was lost or damaged on
// the bus, so the read is done once more. Other errors (a Modbus exception
// from the device, a closed port) would only fail again.
const isTransient = (e) => e?.name === 'TransactionTimedOutError' || e?.message === 'CRC error'

// The pause lets a late reply to the first request arrive while the port
// still waits for that unit and function, so the port drops it and does not
// take it as the answer to the retry.
module.exports = async function readWithRetry (read, { msRetryDelay = 100, onRetry = () => {} } = {}) {
  try {
    return await read()
  } catch (e) {
    if (!isTransient(e)) throw e
    onRetry(e)
    await new Promise((resolve) => setTimeout(resolve, msRetryDelay))
    return read()
  }
}
