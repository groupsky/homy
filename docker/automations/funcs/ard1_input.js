/**
 * @param {number} pin
 * @return {function(object): boolean}
 */
module.exports = function ard1_input ({ pin }) {
  if (pin < 22 || pin > 45) throw new Error(`Invalid input pin ${pin}`)
  /**
   * @param {{t: 'oc'|'ic', p: number, v: 0|1}} payload
   */
  return (payload) => {
    if (payload.p !== pin || payload.t !== 'ic') return

    return payload.v === 1
  }
}
