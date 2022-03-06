const resolve = require('../lib/resolve')

const filterAll = () => true

module.exports = (name, {
  input: inputDef,
  filterInput,
  transform,
  filterOutput,
  output: outputDef,
}) => {
  const startInput = resolve(inputDef)
  filterInput = filterInput != null ? resolve(filterInput) : filterAll
  transform = resolve(transform)
  filterOutput = filterOutput != null ? resolve(filterOutput) : filterAll
  const startOutput = resolve(outputDef)

  return ({
    start: (services) => {
      const runInput = startInput(services)
      const runOutput = startOutput(services)

      return runInput((payload) => {
        if (!filterInput(payload)) {
          return
        }
        const processed = transform(payload)
        if (!filterOutput(processed)) {
          return
        }
        runOutput(processed)
      })
    }
  })
}
