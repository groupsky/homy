function bool_to_ha (value) {
  switch (value) {
    case true: return 'ON'
    case false: return 'OFF'
    default: null
  }
}

module.exports = function bool_to_ha_state(value) {
  return {
    state: bool_to_ha(value)
  }
}
