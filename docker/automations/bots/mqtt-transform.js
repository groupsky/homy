const resolve = require('../lib/resolve')

const filterAll = () => true

module.exports = (name, {
  inputTopic,
  outputTopic,
  transform,
  filterInput,
  filterOutput,
  outputContent = 'json',
  qos = 0,
  retain = false
}) => {
  if (!inputTopic) throw new Error('Missing `inputTopic`')
  if (!outputTopic) throw new Error('Missing `outputTopic`')
  if (!transform) throw new Error('Missing `transform`')
  if (typeof inputTopic !== 'string') throw new Error(`Unsupported \`inputTopic\` type "${typeof inputTopic}"`)
  if (typeof outputTopic !== 'string') throw new Error(`Unsupported \`outputTopic\` type "${typeof outputTopic}"`)

  transform = resolve(transform)
  filterInput = filterInput != null ? resolve(filterInput) : filterAll
  filterOutput = filterOutput != null ? resolve(filterOutput) : filterAll

  return ({
    start: ({ mqtt }) => {
      mqtt.subscribe(inputTopic, (payload) => {
        if (!filterInput(payload)) return
        const output = transform(payload)
        if (!filterOutput(output)) return
        mqtt.publish(outputTopic, output, { content: outputContent, retain, qos })
      })
    }
  })
}
