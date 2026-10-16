const {createPoller, msUntilNextRun, HISTORY_MODELS} = require('./poller')

const location = {latitude: '10.00', longitude: '-20.00'}
const hour = 3600
const t0 = Date.UTC(2026, 9, 16, 6) / 1000 // 2026-10-16T06:00Z

const forecastJson = (time) => ({
    current: {time, interval: 900, temperature_2m: 7},
    hourly: {time: [t0, t0 + hour], temperature_2m: [8, 9]},
})
const historyJson = {hourly: {time: [t0 - 2 * hour, t0 - hour], temperature_2m: [5, 6]}}

function setup({failForecast = false, failHistory = false} = {}) {
    const urls = []
    const written = []
    const log = {info: jest.fn(), error: jest.fn()}
    const fetchJson = jest.fn(async (url) => {
        urls.push(url)
        const isArchive = url.startsWith('https://archive-api.')
        if (isArchive && failHistory) throw new Error('archive down')
        if (!isArchive && failForecast) throw new Error('forecast down')
        return isArchive ? historyJson : forecastJson(t0)
    })
    const writePoints = jest.fn(async (points) => { written.push(...points) })
    const poller = createPoller({location, fetchJson, writePoints, log})
    return {poller, urls, written, log}
}

const kinds = (points) => points.map(p => p.tags.kind)

describe('pollOnce', () => {
    test('first poll writes current, forecast and the last 14 days of history', async () => {
        const {poller, urls, written} = setup()
        await poller.pollOnce(t0 + 2 * 60)

        expect(urls.filter(u => u.startsWith('https://api.'))).toHaveLength(1)
        const archive = urls.filter(u => u.startsWith('https://archive-api.')).map(u => new URL(u).searchParams)
        expect(archive.map(p => p.get('models'))).toEqual(HISTORY_MODELS)
        expect(HISTORY_MODELS).toEqual(['era5_seamless', 'ecmwf_ifs'])
        for (const p of archive) {
            expect(p.get('start_date')).toBe('2026-10-02')
            expect(p.get('end_date')).toBe('2026-10-16')
        }
        expect(kinds(written)).toEqual(['current', 'forecast', 'forecast', 'history', 'history', 'history', 'history'])
    })

    test('later polls in the same hour write only the current values', async () => {
        const {poller, written} = setup()
        await poller.pollOnce(t0 + 2 * 60)
        written.length = 0
        await poller.pollOnce(t0 + 17 * 60)
        expect(kinds(written)).toEqual(['current'])
    })

    test('the next hour writes a new forecast, and the next day refreshes history again', async () => {
        const {poller, written} = setup()
        await poller.pollOnce(t0 + 2 * 60)
        written.length = 0
        await poller.pollOnce(t0 + hour + 2 * 60)
        // The fixture has two forecast hours; one of them is now in the past.
        expect(kinds(written)).toEqual(['current', 'forecast'])
        written.length = 0
        await poller.pollOnce(t0 + 24 * hour + 2 * 60)
        expect(kinds(written)).toContain('history')
    })

    test('a failed forecast call writes nothing for it and is tried again on the next poll', async () => {
        const {poller, written, log} = setup({failForecast: true})
        await poller.pollOnce(t0 + 2 * 60)
        expect(kinds(written)).toEqual(['history', 'history', 'history', 'history'])
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('forecast down'))
    })

    test('a failed history refresh does not stop current values and is tried again on the next poll', async () => {
        const s = setup({failHistory: true})
        await s.poller.pollOnce(t0 + 2 * 60)
        expect(kinds(s.written)).toEqual(['current', 'forecast', 'forecast'])
        expect(s.log.error).toHaveBeenCalledWith(expect.stringContaining('archive down'))
        s.urls.length = 0
        await s.poller.pollOnce(t0 + 17 * 60)
        expect(s.urls.some(u => u.startsWith('https://archive-api.'))).toBe(true)
    })

    test('a failed write is logged and the forecast is written again on the next poll', async () => {
        const log = {info: jest.fn(), error: jest.fn()}
        const fetchJson = async (url) => url.startsWith('https://archive-api.') ? historyJson : forecastJson(t0)
        const writePoints = jest.fn()
            .mockRejectedValueOnce(new Error('influx down'))
            .mockResolvedValue(undefined)
        const poller = createPoller({location, fetchJson, writePoints, log})
        await poller.pollOnce(t0 + 2 * 60)
        expect(log.error).toHaveBeenCalledWith(expect.stringContaining('influx down'))
        writePoints.mockClear()
        await poller.pollOnce(t0 + 17 * 60)
        expect(kinds(writePoints.mock.calls[0][0])).toEqual(['current', 'forecast', 'forecast'])
    })

    test('never logs the coordinates', async () => {
        const {poller, log} = setup({failForecast: true, failHistory: true})
        await poller.pollOnce(t0 + 2 * 60)
        const lines = [...log.info.mock.calls, ...log.error.mock.calls].flat().join('\n')
        expect(lines).not.toContain('10.00')
        expect(lines).not.toContain('-20.00')
    })
})

describe('msUntilNextRun', () => {
    test('runs 2 minutes after each quarter hour', () => {
        const base = Date.UTC(2026, 9, 16, 6, 0, 0)
        expect(msUntilNextRun(base)).toBe(2 * 60 * 1000)
        expect(msUntilNextRun(base + 2 * 60 * 1000)).toBe(15 * 60 * 1000)
        expect(msUntilNextRun(base + 3 * 60 * 1000)).toBe(14 * 60 * 1000)
        expect(msUntilNextRun(base + 16 * 60 * 1000 + 59 * 1000)).toBe(1000)
    })
})
