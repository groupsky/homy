/**
 * @param {number} pin
 * @param {'ic'|'oc'} type
 * @return {function(object): boolean}
 */
module.exports = function ard1_status ({ pin, type }) {
  let inverted = false
  switch (type) {
    case 'oc':
      if (pin < 14 || pin > 21 && pin < 62 || pin > 69) throw new Error(`Invalid output pin ${pin}`)
      inverted = pin >= 14 && pin <= 21
      break
    case 'ic':
      if (pin < 22 || pin > 45) throw new Error(`Invalid input pin ${pin}`)
      break
    default:
      throw new Error(`Invalid type ${type}. Must be "ic" or "oc"`)
  }

  /**
   * @param {{t: 'oc'|'ic', p: number, v: 0|1}} payload
   */
  return (payload) => {
    if (payload.p !== pin || payload.t !== type) return

    return payload.v === (inverted ? 0 : 1)
  }
}
