/**
 * Joins reports that share one cause into one message (#1743): several bots
 * that read the same reader all see its outage within a minute.
 *
 * `report(name)`: the first report of a batch starts a `delayMs` timer; then
 * `send(names)` gets every name reported meanwhile, once each.
 */
const createBatch = ({delayMs = 60 * 1000, send}) => {
  let names = []
  let timer = null
  return (name) => {
    if (!names.includes(name)) names.push(name)
    if (timer) return
    timer = setTimeout(() => {
      const batch = names
      names = []
      timer = null
      send(batch)
    }, delayMs)
  }
}

const shared = new Map()

/** One batch per `key`, shared by every bot of this process that asks for it. */
const sharedBatch = (key, options) => {
  if (!shared.has(key)) shared.set(key, createBatch(options))
  return shared.get(key)
}

module.exports = {createBatch, sharedBatch}
