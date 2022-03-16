/**
 * @param {string} key
 * @return {function(object): any}
 */
module.exports = function get_object_key({ key }) {
  if (!key || typeof key !== 'string') throw new Error(`Invalid key ${key}`)
  /**
   * @param {object} payload
   */
  return (payload) => payload[key]
}
