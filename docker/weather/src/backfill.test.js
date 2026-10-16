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
