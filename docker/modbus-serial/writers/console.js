const logger = (entry, device) => console.log(`[${device.name}]:`, entry)
logger.toString = () => 'console'

const setup = () => logger

module.exports = setup
