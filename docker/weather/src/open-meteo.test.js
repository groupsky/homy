const {
    parseLocation,
    buildForecastUrl,
    buildArchiveUrl,
    currentPoints,
    forecastPoints,
    historyPoints,
    checkResponse,
    yearChunks,
} = require('./open-meteo')

const location = {latitude: '10.00', longitude: '-20.00'}
const hour = 3600
const t0 = Date.UTC(2026, 9, 16, 6) / 1000 // 2026-10-16T06:00Z

describe('parseLocation', () => {
    test('rounds both values to 2 decimals', () => {
        expect(parseLocation('12.345678', '-23.456789')).toEqual({latitude: '12.35', longitude: '-23.46'})
    })

    test.each([
        [undefined, '1'],
        ['', '1'],
        ['abc', '1'],
        ['91', '1'],
        ['1', '-181'],
    ])('rejects latitude %p and longitude %p', (lat, lon) => {
        expect(() => parseLocation(lat, lon)).toThrow(/WEATHER_LATITUDE|WEATHER_LONGITUDE/)
    })
})

describe('buildForecastUrl', () => {
    test('asks for current values and a 48 hour forecast in UTC unix time and m/s', () => {
        const url = new URL(buildForecastUrl(location))
        expect(url.origin + url.pathname).toBe('https://api.open-meteo.com/v1/forecast')
        expect(url.searchParams.get('latitude')).toBe('10.00')
        expect(url.searchParams.get('longitude')).toBe('-20.00')
        expect(url.searchParams.get('current')).toBe('temperature_2m,relative_humidity_2m,dew_point_2m,cloud_cover,precipitation,wind_speed_10m,shortwave_radiation')
        expect(url.searchParams.get('hourly')).toBe(url.searchParams.get('current'))
        expect(url.searchParams.get('forecast_hours')).toBe('48')
        expect(url.searchParams.get('timezone')).toBe('GMT')
        expect(url.searchParams.get('timeformat')).toBe('unixtime')
        expect(url.searchParams.get('wind_speed_unit')).toBe('ms')
    })
})

describe('buildArchiveUrl', () => {
    test('asks one named model for a date range', () => {
        const url = new URL(buildArchiveUrl(location, 'era5_seamless', '2020-12-01', '2020-12-31'))
        expect(url.origin + url.pathname).toBe('https://archive-api.open-meteo.com/v1/archive')
        expect(url.searchParams.get('models')).toBe('era5_seamless')
        expect(url.searchParams.get('start_date')).toBe('2020-12-01')
        expect(url.searchParams.get('end_date')).toBe('2020-12-31')
        expect(url.searchParams.get('hourly')).toContain('cloud_cover')
        expect(url.searchParams.get('timeformat')).toBe('unixtime')
        expect(url.searchParams.get('wind_speed_unit')).toBe('ms')
    })
})

describe('currentPoints', () => {
    test('maps the current block to one point at its own time', () => {
        const json = {
            current: {
                time: t0 + 900, interval: 900,
                temperature_2m: 7.0, relative_humidity_2m: 100, dew_point_2m: 6.9, cloud_cover: 100,
                precipitation: 0.0, wind_speed_10m: 1.4, shortwave_radiation: 2.0,
            },
        }
        expect(currentPoints(json)).toEqual([{
            measurement: 'weather',
            tags: {source: 'open-meteo', kind: 'current', model: 'best_match'},
            fields: {
                temperature: 7, relative_humidity: 100, dew_point: 6.9, cloud_cover: 100,
                precipitation: 0, wind_speed: 1.4, shortwave_radiation: 2,
            },
            integers: {},
            time: t0 + 900,
        }])
    })

    test('leaves out missing values and gives nothing when all are missing', () => {
        expect(currentPoints({current: {time: t0, temperature_2m: 5, cloud_cover: null}})[0].fields)
            .toEqual({temperature: 5})
        expect(currentPoints({current: {time: t0, temperature_2m: null}})).toEqual([])
        expect(currentPoints({})).toEqual([])
    })
})

describe('forecastPoints', () => {
    const json = {
        hourly: {
            time: [t0 - hour, t0, t0 + hour, t0 + 2 * hour],
            temperature_2m: [9, 8, 7, null],
            cloud_cover: [10, 20, 30, null],
        },
    }

    test('stores each hour from the issue hour on, with its lead time and issue time', () => {
        const points = forecastPoints(json, t0 + 17 * 60)
        expect(points).toEqual([
            {
                measurement: 'weather',
                tags: {source: 'open-meteo', kind: 'forecast', model: 'best_match', lead_hours: '0'},
                fields: {temperature: 8, cloud_cover: 20},
                integers: {issued: t0},
                time: t0,
            },
            {
                measurement: 'weather',
                tags: {source: 'open-meteo', kind: 'forecast', model: 'best_match', lead_hours: '1'},
                fields: {temperature: 7, cloud_cover: 30},
                integers: {issued: t0},
                time: t0 + hour,
            },
        ])
    })

    test('gives nothing without an hourly block', () => {
        expect(forecastPoints({}, t0)).toEqual([])
    })
})

describe('historyPoints', () => {
    const json = {
        hourly: {
            time: [t0 - 2 * hour, t0 - hour, t0, t0 + hour],
            temperature_2m: [1, null, 3, 4],
            cloud_cover: [50, null, 70, 80],
        },
    }

    test('tags the model, skips empty hours and hours after now', () => {
        expect(historyPoints(json, 'ecmwf_ifs', t0 + 60)).toEqual([
            {
                measurement: 'weather',
                tags: {source: 'open-meteo', kind: 'history', model: 'ecmwf_ifs'},
                fields: {temperature: 1, cloud_cover: 50},
                integers: {},
                time: t0 - 2 * hour,
            },
            {
                measurement: 'weather',
                tags: {source: 'open-meteo', kind: 'history', model: 'ecmwf_ifs'},
                fields: {temperature: 3, cloud_cover: 70},
                integers: {},
                time: t0,
            },
        ])
    })
})

describe('checkResponse', () => {
    test('returns the body of a good answer', () => {
        expect(checkResponse(200, {hourly: {}})).toEqual({hourly: {}})
    })

    test('throws the reason of an error answer', () => {
        expect(() => checkResponse(400, {error: true, reason: 'Invalid value: foo'}))
            .toThrow('Open-Meteo answered 400: Invalid value: foo')
    })

    test('throws on a non-200 answer without a reason', () => {
        expect(() => checkResponse(429, null)).toThrow('Open-Meteo answered 429')
    })
})

describe('yearChunks', () => {
    test('splits a range into calendar years', () => {
        expect(yearChunks('2020-12-01', '2022-03-04')).toEqual([
            ['2020-12-01', '2020-12-31'],
            ['2021-01-01', '2021-12-31'],
            ['2022-01-01', '2022-03-04'],
        ])
    })

    test('keeps a range inside one year as one chunk', () => {
        expect(yearChunks('2026-10-02', '2026-10-16')).toEqual([['2026-10-02', '2026-10-16']])
    })

    test('rejects a bad or reversed range', () => {
        expect(() => yearChunks('2026-13-01', '2026-12-01')).toThrow()
        expect(() => yearChunks('2026-10-16', '2026-10-01')).toThrow()
    })
})
