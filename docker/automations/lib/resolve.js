function resolve (id, type = 'funcs') {
  if (id == null) throw new Error('Missing `id`')
  if (typeof type !== 'string') throw new Error(`Unsupported \`type\` type "${typeof type}"`)
  switch (typeof id) {
    case 'string':
      return require(`../${type}/${id}`)
    case 'function':
      return id
    case 'object': {
      if (Array.isArray(id)) {
        return resolve('pipe', type)(...id)
      } else {
        const { name, params } = id
        if (typeof name !== 'string') throw new Error(`Unsupported \`id.name\` type "${typeof name}"`)
        return resolve(name, type)(...(Array.isArray(params) ? params : [params]))
      }
    }
    default:
      throw new Error(`Unhandled \'id\' type "${typeof id}"`)
  }
}

module.exports = resolve
