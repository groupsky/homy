const resolve = require('../lib/resolve')

const filterAll = () => true

/**
 * Passes a value on only after it has stayed the same for `ms`.
 *
 * A value equal to the last one passed on goes through at once and cancels a
 * pending change, so a contact that bounces back within `ms` never shows the
 * bounce. A repeat of the pending value (another bit of the same module
 * changed) keeps the timer running from the first change.
 */
const debounce = (run, ms) => {
  let last
  let pending = null
  return (value) => {
    const key = JSON.stringify(value)
    if (last === undefined || key === last) {
      if (pending) clearTimeout(pending.timer)
      pending = null
      last = key
      run(value)
      return
    }
    if (pending?.key === key) return
    if (pending) clearTimeout(pending.timer)
    pending = {
      key,
      timer: setTimeout(() => {
        pending = null
        last = key
        run(value)
      }, ms),
    }
  }
}

module.exports = (name, {
  input: inputDef,
  filterInput,
  transform,
  filterOutput,
  output: outputDef,
  debounceMs = 0,
}) => {
  const startInput = resolve(inputDef)
  filterInput = filterInput != null ? resolve(filterInput) : filterAll
  transform = resolve(transform)
  filterOutput = filterOutput != null ? resolve(filterOutput) : filterAll
  const startOutput = resolve(outputDef)

  return ({
    start: (services) => {
      const runInput = startInput(services)
      const runOutput = debounceMs > 0 ? debounce(startOutput(services), debounceMs) : startOutput(services)

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
