const resolve = require('../lib/resolve')

const call = (input, func) => func(input)

module.exports = function pipe(...funcs) {
  const chain = funcs.map((func) => resolve(func))
  return chain.reduce.bind(chain, call)
}
