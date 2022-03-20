const resolve = require('../lib/resolve')

module.exports = (name, {
  inputFeature,
  inputConfig,
  outputFeature,
  outputConfig,
  toggleConfig,
}) => {
  const FeatureState = resolve('state', 'features')
  const InputFeatureState = FeatureState(inputFeature, inputConfig)
  const OutputFeatureState = FeatureState(outputFeature, outputConfig)

  return ({
    start: (services) => {
      const inputFeatureState = InputFeatureState(services)
      const outputFeatureState = OutputFeatureState(services)

      inputFeatureState.on('change', () => {
        outputFeatureState.toggle(toggleConfig)
      })
    }
  })
}
