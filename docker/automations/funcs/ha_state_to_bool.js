function ha_to_bool (value) {
  switch (value) {
    case 'ON':
      return true
    case 'OFF':
      return false
    default:
      null
  }
}

module.exports = ({ state }) => ha_to_bool(state)
