/**
 * @param {number} pin
 * @return {function(object): boolean}
 */
module.exports = function ard1_set ({ pin }) {
  if (pin < 14 || pin > 21 && pin < 62 || pin > 69) throw new Error(`Invalid output pin ${pin}`)
  /**
   * @param {boolean} payload
   */
  return (payload) => {
    return { pin, value: payload ? 1 : 0 }
  }
}
