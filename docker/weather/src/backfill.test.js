const {backfill} = require('./backfill')

const location = {latitude: '10.00', longitude: '-20.00'}
const t = Date.UTC(2021, 0, 1) / 1000

test('fetches one year at a time from one model and writes every hour that has data', async () => {
    const asked = []
    const fetchJson = async (url) => {
        const p = new URL(url).searchParams
        asked.push([p.get('models'), p.get('start_date'), p.get('end_date')])
        return {hourly: {time: [t, t + 3600], temperature_2m: [1, null]}}
    }
    const written = []
    const writePoints = async (points) => { written.push(...points) }
    const log = {info: jest.fn()}

    const total = await backfill({
        location, fetchJson, writePoints, log,
        model: 'era5_seamless', startDate: '2020-12-01', endDate: '2021-02-01', nowSec: t + 86400 * 400,
    })

    expect(asked).toEqual([
        ['era5_seamless', '2020-12-01', '2020-12-31'],
        ['era5_seamless', '2021-01-01', '2021-02-01'],
    ])
    expect(total).toBe(2)
    expect(written.map(p => p.tags)).toEqual([
        {source: 'open-meteo', kind: 'history', model: 'era5_seamless'},
        {source: 'open-meteo', kind: 'history', model: 'era5_seamless'},
    ])
    expect(log.info).toHaveBeenCalledTimes(2)
})

test('rejects a missing start date before any call', async () => {
    const fetchJson = jest.fn()
    await expect(backfill({
        location, fetchJson, writePoints: async () => {}, log: {info() {}},
        model: 'era5_seamless', startDate: undefined, endDate: '2021-02-01', nowSec: t,
    })).rejects.toThrow('Not a date')
    expect(fetchJson).not.toHaveBeenCalled()
})

test('stops on the first failed call so the run can be repeated', async () => {
    const fetchJson = async () => { throw new Error('Open-Meteo answered 429') }
    await expect(backfill({
        location, fetchJson, writePoints: async () => {}, log: {info() {}},
        model: 'era5_seamless', startDate: '2020-12-01', endDate: '2021-02-01', nowSec: t,
    })).rejects.toThrow('429')
})

describe('backfillEstimate', () => {
    const {backfillEstimate} = require('./backfill')
    const day = 86400

    test('walks the range in 30-day steps and stops at the current hour', async () => {
        const start = Date.UTC(2022, 6, 20) / 1000
        const nowSec = start + 40 * day + 1800
        const calls = []
        const estimateHours = async (from, to) => {
            calls.push([from, to])
            return [{time: from}]
        }
        const written = []
        const total = await backfillEstimate({
            estimateHours, writePoints: async (p) => { written.push(...p) }, log: {info() {}},
            startDate: '2022-07-20', endDate: '2022-12-31', nowSec,
        })
        expect(calls).toEqual([
            [start, start + 30 * day],
            [start + 30 * day, start + 40 * day],
        ])
        expect(total).toBe(2)
        expect(written).toHaveLength(2)
    })

    test('includes the whole end day', async () => {
        const calls = []
        await backfillEstimate({
            estimateHours: async (from, to) => { calls.push([from, to]); return [] },
            writePoints: async () => {}, log: {info() {}},
            startDate: '2024-01-01', endDate: '2024-01-02', nowSec: Date.UTC(2026, 0, 1) / 1000,
        })
        expect(calls).toEqual([[Date.UTC(2024, 0, 1) / 1000, Date.UTC(2024, 0, 3) / 1000]])
    })

    test('rejects a bad date', async () => {
        await expect(backfillEstimate({
            estimateHours: jest.fn(), writePoints: jest.fn(), log: {info() {}},
            startDate: '2024-02-30', endDate: '2024-03-01', nowSec: 0,
        })).rejects.toThrow('Not a date')
    })
})

describe('pickEstimator', () => {
    const {pickEstimator} = require('./backfill')
    const factories = {collector: () => 'c', mower: () => 'm'}

    test('returns the factory for a known source', () => {
        expect(pickEstimator(factories, 'mower')()).toBe('m')
    })

    test.each([undefined, 'nope', 'toString', '__proto__'])('rejects %p', (source) => {
        expect(() => pickEstimator(factories, source)).toThrow('Unknown source')
    })
})
