/**
 * @param {number} pin
 * @return {function(object): boolean}
 */
module.exports = function ard1_output_status ({ pin }) {
  if (pin < 14 || pin > 21 && pin < 62 || pin > 69) throw new Error(`Invalid output pin ${pin}`)
  const inverted = pin >= 14 && pin <= 21
  /**
   * @param {{t: 'oc'|'ic', p: number, v: 0|1}} payload
   */
  return (payload) => {
    if (payload.p !== pin || payload.t !== 'oc') return

    return payload.v === (inverted ? 0 : 1)
  }
}
