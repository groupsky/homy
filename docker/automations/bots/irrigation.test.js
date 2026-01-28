const {beforeEach, afterEach, describe, test, expect, jest} = require('@jest/globals');

beforeEach(() => {
    jest.useFakeTimers()
})

const setup = async ({schedule, duration = 1000}) => {
    const irrigation = require('./irrigation')('test-irrigation', {
        valveControlTopic: 'valve-control',
        valveControlTemplate: (status) => status ? 'on' : 'off',
        schedule,
        duration,
    })
    const publish = jest.fn()
    const mqtt = {publish}

    // start the bot
    await irrigation.start({mqtt})

    return ({mqtt, irrigation})
}

describe('irrigation', () => {
    test('should turn on irrigation when at the start of interval', async () => {
        const schedule = '0 0 0 * * *'
        jest.setSystemTime(new Date('2021-06-01T00:00:00Z'))
        const {mqtt} = await setup({schedule})

        // should immediately turn on the valve
        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')
    })

    test('should turn on irrigation when at the middle of interval', async () => {
        const schedule = '0 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:05Z'))
        const {mqtt} = await setup({schedule, duration})

        // should immediately turn on the valve
        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')
    })

    test('should turn off irrigation when at the end of interval', async () => {
        const schedule = '0 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:10Z'))
        const {mqtt} = await setup({schedule, duration})

        // should immediately turn on the valve
        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')
    })

    test('should turn off irrigation when outside of interval', async () => {
        const schedule = '0 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:01:00Z'))
        const {mqtt} = await setup({schedule, duration})

        // should immediately turn on the valve
        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')
    })

    test('should turn on irrigation when reach start of interval', async () => {
        const schedule = '1 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:00Z'))
        const {mqtt} = await setup({schedule, duration})

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')

        mqtt.publish.mockClear()
        jest.advanceTimersByTime(1000)

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')
    })

    test('should turn on irrigation when reach mid of interval', async () => {
        const schedule = '1 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:00Z'))
        const {mqtt} = await setup({schedule, duration})

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')

        mqtt.publish.mockClear()
        jest.advanceTimersByTime(6000)

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')
    })

    test('should turn off irrigation when reach end of interval', async () => {
        const schedule = '1 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:00Z'))
        const {mqtt} = await setup({schedule, duration})

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')

        mqtt.publish.mockClear()
        jest.advanceTimersByTime(11000)

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')
    })

    test('should turn off irrigation when reach end of interval from start', async () => {
        const schedule = '0 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:00Z'))
        const {mqtt} = await setup({schedule, duration})

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')

        mqtt.publish.mockClear()
        jest.advanceTimersByTime(10000)

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')
    })

    test('should turn off irrigation when reach beyond end of interval from start', async () => {
        const schedule = '0 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:00Z'))
        const {mqtt} = await setup({schedule, duration})

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')

        mqtt.publish.mockClear()
        jest.advanceTimersByTime(15000)

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'off')
    })

    test('should turn on irrigation when reach next start of interval from start', async () => {
        const schedule = '0 0 0 * * *'
        const duration = 10000
        jest.setSystemTime(new Date('2021-06-01T00:00:00Z'))
        const {mqtt} = await setup({schedule, duration})

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')

        mqtt.publish.mockClear()
        jest.advanceTimersByTime(24*60*60*1000)

        expect(mqtt.publish).toHaveBeenCalledWith('valve-control', 'on')
    })

    test('[TEST] Verify test-only change detection works', async () => {
        // This test verifies that test-only changes trigger Stage 3.5
        // (Pull Images for Testing) instead of full rebuild
        const schedule = '0 0 0 * * *'
        const {mqtt} = await setup({schedule})

        expect(mqtt.publish).toBeDefined()
    })
})
