const resolve = require('../lib/resolve')

module.exports = (name, {
  inputFeature,
  inputConfig,
  inputFilter,
  outputFeature,
  outputConfig,
  toggleConfig,
}) => {
  const FeatureState = resolve('state', 'features')
  const InputFeatureState = FeatureState(inputFeature, inputConfig)
  const OutputFeatureState = FeatureState(outputFeature, outputConfig)
  const filter = inputFilter ? resolve(inputFilter) : () => true

  return ({
    start: (services) => {
      const inputFeatureState = InputFeatureState(services)
      const outputFeatureState = OutputFeatureState(services)

      inputFeatureState.on('change', (newVal) => {
        if (filter(newVal)) {
          outputFeatureState.toggle(toggleConfig)
        }
      })
    }
  })
}
