const sdm630 = require('../sdm630')
const ex9em = require('../ex9em')
const orWe514 = require('../or-we-514')

// current_power.p must be real (active) power in W for every meter (#1749).
// The readings below are real values from the main meter (SDM630), the
// borehole pump (EX9EM) and the microwave (OR-WE-514), taken from the `raw`
// measurement. At idle the apparent power (VA) is far above the real power.

const fields = (point) => point.toLineProtocol().split(' ')[1]
const field = (point, name) => {
    const match = fields(point).match(new RegExp(`(?:^|,)${name}=([^,]+)`))
    return match ? Number(match[1]) : undefined
}
const phases = (points) => Object.fromEntries(
    points.filter(p => p.toLineProtocol().startsWith('current_power'))
        .map(p => [p.toLineProtocol().match(/phase=(\w)/)[1], field(p, 'p')]))

describe('sdm630 (main meter)', () => {
    // One reading on each of the three sample days of #1749. On those days the
    // apparent power overstated the counter by 19 %, 20 % and 13 %.
    const days = [
        {
            day: '2026-10-06',
            ap: 2736.199462890625, bp: 111.55901336669922, cp: 77.34474182128906,
            a_ap: 2748.030029296875, b_ap: 188.0555419921875, c_ap: 200.06419372558594,
            total_p: 2925.103271484375, total_va: 2984.134765625,
        },
        {
            day: '2026-10-07',
            ap: 516.817138671875, bp: 120.24439239501953, cp: 67.70328521728516,
            a_ap: 577.4514770507812, b_ap: 188.30905151367188, c_ap: 192.3089141845703,
            total_p: 701.0265502929688, total_va: 910.5597534179688,
        },
        {
            day: '2026-10-10',
            ap: 7201.080078125, bp: 1285.3790283203125, cp: 2428.41845703125,
            a_ap: 7204.35791015625, b_ap: 1352.5665283203125, c_ap: 2455.4365234375,
            total_p: 10929.572265625, total_va: 10967.791015625,
        },
    ]
    const reading = (d) => ({
        ...d,
        device: 'main', _type: 'sdm630', _addr: 1, _tz: new Date(`${d.day}T18:00:00Z`),
        av: 230, bv: 231, cv: 232, ac: 1, bc: 2, cc: 3,
        total_kwh: 50000, total_import_kwh: 50000, total_export_kwh: 390.84,
    })

    test.each(days)('$day: p is the real power of each phase, not the apparent power', (d) => {
        const p = phases(sdm630(reading(d)))
        expect(p).toEqual({A: d.ap, B: d.bp, C: d.cp})
        // The sum of the phases matches the meter's real-power total, not its
        // apparent-power total. (The totals are read a moment apart from the phases.)
        const sum = p.A + p.B + p.C
        expect(Math.abs(sum - d.total_p)).toBeLessThan(Math.abs(sum - d.total_va))
    })

    test('voltage and current stay as they were', () => {
        const points = sdm630(reading(days[0]))
        expect(field(points[0], 'v')).toBe(230)
        expect(field(points[2], 'c')).toBe(3)
    })
})

describe('ex9em (borehole pump)', () => {
    const base = {device: 'water_pump', _type: 'ex9em', _addr: 1}

    test.each([
        ['running', {p: 800, ap: 844, rp: 151, c: 3.6, v: 228.2, pow: 0.973, tot_act: 8058.53}, 800],
        ['idle', {p: 11, ap: 58, rp: 54, c: 0.2, v: 230.4, pow: 0.238, tot_act: 8066.01}, 11],
    ])('%s: p is the real power', (_, values, expected) => {
        const [power, meter] = ex9em({...base, ...values, _tz: new Date('2026-10-10T06:43:41Z')})
        expect(field(power, 'p')).toBe(expected)
        expect(field(power, 'v')).toBe(values.v)
        expect(field(meter, 'total')).toBe(values.tot_act)
    })
})

describe('or-we-514 (microwave)', () => {
    const base = {device: 'microwave', _type: 'or-we-514', _addr: 2}

    test.each([
        ['running', {p: 1663, ap: 1665, rp: 87, c: 7.246, v: 229.76, pow: 0.998, tot_act: 340.12}, 1663],
        ['idle, purely reactive', {p: 0, ap: 35, rp: 35, c: 0.151, v: 231.3, pow: 0.027, tot_act: 341.9}, 0],
    ])('%s: p is the real power', (_, values, expected) => {
        const [power, meter] = orWe514({...base, ...values, _tz: new Date('2026-10-10T12:47:13Z')})
        expect(field(power, 'p')).toBe(expected)
        expect(field(meter, 'total')).toBe(values.tot_act)
    })
})
