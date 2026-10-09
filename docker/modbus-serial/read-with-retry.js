// A timeout or a CRC error most often means one frame was lost or damaged on
// the bus, so the read is done once more. Other errors (a Modbus exception
// from the device, a closed port) would only fail again.
const isTransient = (e) => e?.name === 'TransactionTimedOutError' || e?.message === 'CRC error'

// The pause is for a late reply to the first request. If it comes before the
// retry is sent, modbus-serial matches it to the timed-out request and drops
// it; after that it could be taken as the answer to the retry. A reply that
// is later than the pause, or only part of one, can still make the retry fail.
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
