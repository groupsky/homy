/**
 * Creates a filter that drops a module reading where several inputs drop to
 * 0 at the same moment.
 *
 * The input modules lose their 12 V supply in a mains dip and, while they
 * restart, report `inputs: 0` for a few seconds. Without this filter every
 * closed latching wall switch on the module looks toggled and every door and
 * window looks open (#1956). Dropping the reading keeps the last good value,
 * so when the real reading comes back only the bits that really changed
 * count.
 *
 * A 0 after a reading with one bit set is a real change (a button released
 * while every other input is open) and passes.
 *
 * @return {function({inputs?: number}): boolean} one per bot: it keeps the last good reading
 */
module.exports = () => {
  let last
  return (payload) => {
    const inputs = payload?.inputs
    // `x & (x - 1)` clears the lowest set bit: non-zero means 2 or more bits set
    if (inputs === 0 && last != null && (last & (last - 1)) !== 0) {
      return false
    }
    if (typeof inputs === 'number') last = inputs
    return true
  }
}
