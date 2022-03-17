/**
 * @param {string} key
 * @return {function(any): Object}
 */
module.exports = function create_object_key({ key }) {
  if (!key || typeof key !== 'string') throw new Error(`Invalid key ${key}`)
  /**
   * @param {any} payload
   */
  return (payload) => ({[key]: payload})
}
