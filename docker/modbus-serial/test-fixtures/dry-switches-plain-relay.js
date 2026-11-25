// The deployed dry-switches config plus a relay board with no restore config,
// like relays32-47 on the monitoring bus: it must get no extra reads (#2008).
const config = require('../../../config/modbus-serial/dry-switches.js')
module.exports = {
  ...config,
  devices: [
    ...config.devices,
    {name: 'relays32-47', address: 3, type: 'aspar-mod-16ro', options: {maxMsBetweenReports: 60 * 1000}},
  ],
}
