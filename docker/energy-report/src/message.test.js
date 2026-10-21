import { test } from 'node:test'
import assert from 'node:assert/strict'
import { telegramText, sendTelegram } from './message.js'

const rows = [
  { meter: 'main', fields: { kwh: 1322.3, kwh_day: 681.1, kwh_night: 641.2, share_pct: 100, night_share_pct: 48.491, cost_eur: 164.443, kwh_last_year: 1257.1, change_pct: 5.187 } },
  { meter: 'water_pump', fields: { kwh: 120.4, kwh_day: 90, kwh_night: 30.4, share_pct: 9.105 } },
  { meter: 'boiler', fields: { kwh: 232.6, kwh_day: 109, kwh_night: 123.6, share_pct: 17.591 } },
  { meter: 'heat_pump', fields: { kwh: 269.8, kwh_day: 175.8, kwh_night: 94, share_pct: 20.404 } },
  { meter: 'charger', fields: { kwh: 332.9, kwh_day: 67.6, kwh_night: 265.3, share_pct: 25.176 } },
  { meter: 'not_metered', fields: { kwh: 366.6, kwh_day: 238.7, kwh_night: 127.9, share_pct: 27.724 } }
]

test('telegramText: totals, cost, last year, the top 3 loads and the link', () => {
  assert.equal(telegramText('2025-11', rows, 'http://grafana/d/energy-monthly'), [
    '<b>Energy 2025-11</b>',
    'Main meter: 1322 kWh (day 681, night 641), night share 48.5 %',
    'Cost: 164.44 EUR',
    'Against 2024-11: +5.2 % (1257 kWh)',
    'Top loads: Car charger 333 kWh (25.2 %), Heat pump 270 kWh (20.4 %), Hot-water element 233 kWh (17.6 %)',
    'Dashboard: http://grafana/d/energy-monthly?var-month=2025-11'
  ].join('\n'))
})

test('telegramText names the dashboard and has no link when no URL is set', () => {
  const text = telegramText('2025-11', rows, undefined)
  assert.equal(text.split('\n').at(-1), 'Dashboard: Grafana, "Energy by month", month 2025-11')
  assert.doesNotMatch(text, /https?:/)
})

test('telegramText leaves out the cost and last year when the month has none', () => {
  const main = { kwh: 1100, kwh_day: 700, kwh_night: 400, share_pct: 100, night_share_pct: 36.364 }
  const text = telegramText('2024-02', [{ meter: 'main', fields: main }, rows[1]], 'http://grafana/d/energy-monthly')
  assert.equal(text, [
    '<b>Energy 2024-02</b>',
    'Main meter: 1100 kWh (day 700, night 400), night share 36.4 %',
    'Top loads: Borehole pump 120 kWh (9.1 %)',
    'Dashboard: http://grafana/d/energy-monthly?var-month=2024-02'
  ].join('\n'))
})

test('telegramText shows a fall against last year with a minus sign', () => {
  const main = { ...rows[0].fields, change_pct: -3.14 }
  assert.match(telegramText('2025-11', [{ meter: 'main', fields: main }], 'http://grafana/d/energy-monthly'), /Against 2024-11: -3\.1 % \(1257 kWh\)/)
})

test('telegramText escapes the link for Telegram HTML', () => {
  const text = telegramText('2025-11', rows, 'http://grafana/d/energy-monthly?orgId=1')
  assert.match(text, /Dashboard: http:\/\/grafana\/d\/energy-monthly\?orgId=1&amp;var-month=2025-11$/)
})

test('sendTelegram posts the text to telegram-bridge as energy-report', async () => {
  const calls = []
  const fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200 } }
  const sent = await sendTelegram({ url: 'http://telegram-bridge:3000/webhook', fetch, log: () => {} }, 'hello')
  assert.equal(sent, true)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://telegram-bridge:3000/webhook')
  assert.equal(calls[0].options.method, 'POST')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.deepEqual(JSON.parse(calls[0].options.body), { source: 'energy-report', message: 'hello' })
})

test('sendTelegram logs a refused message and does not throw', async () => {
  const logged = []
  const fetch = async () => ({ ok: false, status: 502 })
  assert.equal(await sendTelegram({ url: 'http://x', fetch, log: (m) => logged.push(m) }, 'hello'), false)
  assert.match(logged.join('\n'), /HTTP 502/)
})

test('sendTelegram logs a failed call and does not throw', async () => {
  const logged = []
  const fetch = async () => { throw new Error('connect ECONNREFUSED') }
  assert.equal(await sendTelegram({ url: 'http://x', fetch, log: (m) => logged.push(m) }, 'hello'), false)
  assert.match(logged.join('\n'), /ECONNREFUSED/)
})
