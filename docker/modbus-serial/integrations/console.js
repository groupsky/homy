const logger = (entry, device) => console.log(`[${device.name}]:`, entry)
logger.toString = () => 'console'

const setup = () => ({ publish: logger })

module.exports = setup
