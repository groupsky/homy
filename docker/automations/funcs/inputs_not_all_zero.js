/**
 * Drops a module reading where every input is 0 at once.
 *
 * The input modules lose their 12 V supply in a mains dip and, while they
 * restart, report `inputs: 0` for a few seconds. In the house this never
 * happens for real: some door or window contacts are always closed. Without
 * this filter every latching wall switch on the module looks toggled and
 * every door and window looks open (#1956). Dropping the reading keeps the
 * last good value, so when the real reading comes back only the bits that
 * really changed count.
 */
module.exports = (payload) => payload?.inputs !== 0
