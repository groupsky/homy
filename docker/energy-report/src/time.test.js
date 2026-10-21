import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthBounds, addMonths, monthOf, monthsBetween, localDay, lastReadyMonth, nextRunAfter } from './time.js'

const H = 3600 * 1000
const at = (iso) => Date.parse(iso)
const iso = (ms) => new Date(ms).toISOString()

test('monthBounds gives the local month in UTC', () => {
  const { start, end } = monthBounds('2025-11')
  assert.equal(iso(start), '2025-10-31T22:00:00.000Z')
  assert.equal(iso(end), '2025-11-30T22:00:00.000Z')
  assert.equal((end - start) / H, 720)
})

test('monthBounds: the month of the spring clock change has 743 hours', () => {
  const { start, end } = monthBounds('2026-03')
  assert.equal(iso(start), '2026-02-28T22:00:00.000Z')
  assert.equal(iso(end), '2026-03-31T21:00:00.000Z')
  assert.equal((end - start) / H, 743)
})

test('monthBounds: the month of the autumn clock change has 745 hours', () => {
  const { start, end } = monthBounds('2025-10')
  assert.equal(iso(start), '2025-09-30T21:00:00.000Z')
  assert.equal(iso(end), '2025-10-31T22:00:00.000Z')
  assert.equal((end - start) / H, 745)
})

test('monthBounds rejects a month that is not YYYY-MM', () => {
  assert.throws(() => monthBounds('2025-13'), /YYYY-MM/)
  assert.throws(() => monthBounds('2025-1'), /YYYY-MM/)
})

test('addMonths moves across years', () => {
  assert.equal(addMonths('2025-11', 2), '2026-01')
  assert.equal(addMonths('2026-01', -1), '2025-12')
  assert.equal(addMonths('2026-03', -12), '2025-03')
})

test('monthOf gives the local month', () => {
  assert.equal(monthOf(at('2025-10-31T21:59:59Z')), '2025-10')
  assert.equal(monthOf(at('2025-10-31T22:00:00Z')), '2025-11')
})

test('monthsBetween lists the months, both ends included', () => {
  assert.deepEqual(monthsBetween('2023-11', '2024-02'), ['2023-11', '2023-12', '2024-01', '2024-02'])
  assert.deepEqual(monthsBetween('2024-02', '2023-11'), [])
})

test('localDay gives the day of the month in local time', () => {
  assert.equal(localDay(at('2026-10-31T22:30:00Z')), 1) // 2026-11-01 00:30 local
  assert.equal(localDay(at('2026-10-31T21:30:00Z')), 31)
})

test('lastReadyMonth: a month is ready from 00:30 local on the 1st of the next month', () => {
  // 2026-11-01 00:29 local: October is not ready yet
  assert.equal(lastReadyMonth(at('2026-10-31T22:29:00Z')), '2026-09')
  // 2026-11-01 00:30 local
  assert.equal(lastReadyMonth(at('2026-10-31T22:30:00Z')), '2026-10')
  assert.equal(lastReadyMonth(at('2026-10-21T08:00:00Z')), '2026-09')
})

test('nextRunAfter is 00:30 local on the next 1st', () => {
  // in summer time the 1st of November is already in winter time (UTC+2)
  assert.equal(iso(nextRunAfter(at('2026-10-21T08:00:00Z'))), '2026-10-31T22:30:00.000Z')
  // in winter time the 1st of April is already in summer time (UTC+3)
  assert.equal(iso(nextRunAfter(at('2026-03-15T08:00:00Z'))), '2026-03-31T21:30:00.000Z')
  // December to January
  assert.equal(iso(nextRunAfter(at('2026-12-05T08:00:00Z'))), '2026-12-31T22:30:00.000Z')
})

test('nextRunAfter: before 00:30 on the 1st it is the same day; at 00:30 it is the next month', () => {
  // 2026-11-01 00:10 local
  assert.equal(iso(nextRunAfter(at('2026-10-31T22:10:00Z'))), '2026-10-31T22:30:00.000Z')
  // 2026-11-01 00:30 local
  assert.equal(iso(nextRunAfter(at('2026-10-31T22:30:00Z'))), '2026-11-30T22:30:00.000Z')
})
