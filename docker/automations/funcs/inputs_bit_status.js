/**
 * @param {number} bit
 * @return {function(object): boolean}
 */
module.exports = function inputs_bit ({ bit }) {
  if (bit < 0 || bit > 64) throw new Error(`Invalid input bit ${bit}`)
  /**
   * @param {{inputs: number}} payload
   */
  return (payload) => Boolean(payload.inputs & (1 << bit))
}
