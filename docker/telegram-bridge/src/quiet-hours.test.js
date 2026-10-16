import { describe, test, expect } from '@jest/globals'
import { isQuietTime, isSafetyMessage, sendSilently } from './quiet-hours.js'

// Times are local wall-clock times with their offset written out: +02:00 is
// winter time (EET) and +03:00 is summer time (EEST) in Europe/Sofia.
const at = (localIso) => new Date(localIso)

const grafana = (...labelSets) => ({
  status: 'firing',
  alerts: labelSets.map((labels) => ({ status: 'firing', labels: { alertname: 'Some alert', ...labels } })),
})

describe('isQuietTime (23:00 to 07:00 Europe/Sofia)', () => {
  test('starts at 23:00', () => {
    expect(isQuietTime(at('2026-11-02T22:59:59+02:00'))).toBe(false)
    expect(isQuietTime(at('2026-11-02T23:00:00+02:00'))).toBe(true)
  })

  test('ends at 07:00', () => {
    expect(isQuietTime(at('2026-11-03T06:59:59+02:00'))).toBe(true)
    expect(isQuietTime(at('2026-11-03T07:00:00+02:00'))).toBe(false)
  })

  test('covers midnight', () => {
    expect(isQuietTime(at('2026-11-03T00:00:00+02:00'))).toBe(true)
    expect(isQuietTime(at('2026-11-03T03:30:00+02:00'))).toBe(true)
  })

  test('is not quiet in the day', () => {
    expect(isQuietTime(at('2026-07-15T12:00:00+03:00'))).toBe(false)
  })

  // Summer time starts on 2026-03-29 at 03:00 local. A fixed UTC+2 offset
  // would read 07:30 summer time as 06:30 and keep it quiet.
  test('2026-03-29: ends at 07:00 on the new summer clock', () => {
    expect(isQuietTime(at('2026-03-29T06:59:00+03:00'))).toBe(true)
    expect(isQuietTime(at('2026-03-29T07:00:00+03:00'))).toBe(false)
    expect(isQuietTime(at('2026-03-29T07:30:00+03:00'))).toBe(false)
    expect(isQuietTime(at('2026-03-29T23:00:00+03:00'))).toBe(true)
  })

  // Summer time ends on 2026-10-25 at 04:00 local; 03:00-04:00 happens twice.
  // A fixed UTC+3 offset would read 06:30 winter time as 07:30 and ring.
  test('2026-10-25: quiet through the repeated hour, ends at 07:00 on the new winter clock', () => {
    expect(isQuietTime(at('2026-10-24T23:00:00+03:00'))).toBe(true)
    expect(isQuietTime(at('2026-10-25T03:30:00+03:00'))).toBe(true)
    expect(isQuietTime(at('2026-10-25T03:30:00+02:00'))).toBe(true)
    expect(isQuietTime(at('2026-10-25T06:30:00+02:00'))).toBe(true)
    expect(isQuietTime(at('2026-10-25T07:00:00+02:00'))).toBe(false)
    expect(isQuietTime(at('2026-10-25T22:59:00+02:00'))).toBe(false)
  })
})

describe('isSafetyMessage', () => {
  test('a Grafana alert with the label safety="true" is safety', () => {
    expect(isSafetyMessage(grafana({ safety: 'true' }))).toBe(true)
  })

  test('one labelled alert among others is enough', () => {
    expect(isSafetyMessage(grafana({}, { safety: 'true' }, {}))).toBe(true)
  })

  test('a resolved labelled alert is still safety', () => {
    const message = grafana({ safety: 'true' })
    message.status = 'resolved'
    message.alerts[0].status = 'resolved'
    expect(isSafetyMessage(message)).toBe(true)
  })

  test('alerts without the label are not safety', () => {
    expect(isSafetyMessage(grafana({}, { severity: 'critical' }))).toBe(false)
    expect(isSafetyMessage(grafana({ safety: 'false' }))).toBe(false)
  })

  test('a direct message is safety only with "safety": true', () => {
    expect(isSafetyMessage({ message: 'x', safety: true })).toBe(true)
    expect(isSafetyMessage({ message: 'x', safety: 'true' })).toBe(false)
    expect(isSafetyMessage({ message: 'x' })).toBe(false)
  })

  test('a raw string or null is not safety', () => {
    expect(isSafetyMessage('text')).toBe(false)
    expect(isSafetyMessage(null)).toBe(false)
  })
})

describe('sendSilently', () => {
  const night = at('2026-11-03T02:00:00+02:00')
  const day = at('2026-11-03T12:00:00+02:00')

  test('a non-safety message is silent at night only', () => {
    expect(sendSilently(grafana({}), night)).toBe(true)
    expect(sendSilently(grafana({}), day)).toBe(false)
  })

  test('a safety message is never silent', () => {
    expect(sendSilently(grafana({ safety: 'true' }), night)).toBe(false)
    expect(sendSilently({ message: 'x', safety: true }, night)).toBe(false)
  })
})
