/**
 * @param {number} bit
 * @return {function(object): boolean}
 */
module.exports = function bit_to_bool ({ bit }) {
  if (bit < 0 || bit > 64) throw new Error(`Invalid bit ${bit}`)
  /**
   * @param {number} payload
   */
  return (payload) => Boolean(payload & (1 << bit))
}
