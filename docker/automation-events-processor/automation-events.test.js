// End-to-end tests for automation events processor service

const {SAMPLE_BOILER_DECISION_EVENT} = require('./test-constants')

describe('Automation Events Processor Service', () => {
  it('should export processAutomationDecisionEvent function', () => {
    const {processAutomationDecisionEvent} = require('./processor')
    expect(typeof processAutomationDecisionEvent).toBe('function')
  })

  it('should process automation events correctly', () => {
    const {processAutomationDecisionEvent} = require('./processor')

    const points = processAutomationDecisionEvent(SAMPLE_BOILER_DECISION_EVENT)

    expect(points).toHaveLength(1)
    expect(points[0].name).toBe('automation_status')
    expect(points[0].tags.service).toBe('boiler_controller')
  })
})