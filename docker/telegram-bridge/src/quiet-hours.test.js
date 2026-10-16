import { describe, test, expect } from '@jest/globals'
import { isQuietTime, isSafetyMessage, createQuietHours } from './quiet-hours.js'

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

describe('createQuietHours', () => {
  // Decides like the server: silent or not, then records the message as sent
  // only when Telegram accepted it.
  const sender = (quietHours) => (webhookData, date, { ok = true } = {}) => {
    const silent = quietHours.sendSilently(webhookData, date)
    if (ok) quietHours.markSent(webhookData)
    return silent
  }

  const night = at('2026-11-03T02:00:00+02:00')
  const later = at('2026-11-03T03:00:00+02:00')
  const day = at('2026-11-03T12:00:00+02:00')

  // A Grafana alert as the webhook sends it: the fingerprint names the alert,
  // startsAt names its firing episode.
  const safetyAlert = ({ status = 'firing', fingerprint = 'aaa111', startsAt = '2026-11-03T01:55:00Z' } = {}) => ({
    status,
    alerts: [{ status, fingerprint, startsAt, labels: { alertname: 'Tyre', safety: 'true' } }],
  })

  test('a non-safety message is silent at night only', () => {
    const sendSilently = sender(createQuietHours())
    expect(sendSilently(grafana({}), night)).toBe(true)
    expect(sendSilently(grafana({}), day)).toBe(false)
  })

  test('the first message of a safety alert rings at night', () => {
    const sendSilently = sender(createQuietHours())
    expect(sendSilently(safetyAlert(), night)).toBe(false)
  })

  test('a repeat of the same safety alert is silent at night', () => {
    const sendSilently = sender(createQuietHours())
    sendSilently(safetyAlert(), night)
    expect(sendSilently(safetyAlert(), later)).toBe(true)
  })

  test('a safety alert first sent in the day repeats silently at night', () => {
    const sendSilently = sender(createQuietHours())
    expect(sendSilently(safetyAlert({ startsAt: '2026-11-02T10:00:00Z' }), day)).toBe(false)
    expect(sendSilently(safetyAlert({ startsAt: '2026-11-02T10:00:00Z' }), night)).toBe(true)
  })

  test('a repeat still rings in the day', () => {
    const sendSilently = sender(createQuietHours())
    sendSilently(safetyAlert(), night)
    expect(sendSilently(safetyAlert(), day)).toBe(false)
  })

  test('a new firing episode of the same alert rings again', () => {
    const sendSilently = sender(createQuietHours())
    sendSilently(safetyAlert(), night)
    expect(sendSilently(safetyAlert({ startsAt: '2026-11-03T02:40:00Z' }), later)).toBe(false)
  })

  test('a resolved safety alert rings, and its next firing rings too', () => {
    const sendSilently = sender(createQuietHours())
    sendSilently(safetyAlert(), night)
    expect(sendSilently(safetyAlert({ status: 'resolved' }), later)).toBe(false)
    expect(sendSilently(safetyAlert(), later)).toBe(false)
  })

  test('a message with a new safety alert next to a repeated one rings', () => {
    const sendSilently = sender(createQuietHours())
    sendSilently(safetyAlert(), night)
    const both = safetyAlert()
    both.alerts.push({ status: 'firing', fingerprint: 'bbb222', startsAt: '2026-11-03T02:50:00Z', labels: { alertname: 'Tyre', safety: 'true' } })
    expect(sendSilently(both, later)).toBe(false)
  })

  test('a direct message with "safety": true always rings', () => {
    const sendSilently = sender(createQuietHours())
    expect(sendSilently({ message: 'x', safety: true }, night)).toBe(false)
    expect(sendSilently({ message: 'x', safety: true }, later)).toBe(false)
  })

  test('a resend after a failed send still rings', () => {
    const sendSilently = sender(createQuietHours())
    expect(sendSilently(safetyAlert(), night, { ok: false })).toBe(false)
    expect(sendSilently(safetyAlert(), later)).toBe(false)
  })

  test('an alert without startsAt always rings', () => {
    const sendSilently = sender(createQuietHours())
    const noStart = { status: 'firing', alerts: [{ status: 'firing', fingerprint: 'ccc333', labels: { safety: 'true' } }] }
    expect(sendSilently(noStart, night)).toBe(false)
    expect(sendSilently(noStart, later)).toBe(false)
  })
})
