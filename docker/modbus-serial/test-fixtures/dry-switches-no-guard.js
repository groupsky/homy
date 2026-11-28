// The deployed dry-switches config without the power dip guard: the reader
// must then publish every reading at once, as before #2007.
const { powerDipGuard, ...config } = require('../../../config/modbus-serial/dry-switches.js') // eslint-disable-line no-unused-vars
module.exports = config
