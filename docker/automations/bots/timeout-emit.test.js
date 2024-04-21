const {beforeEach, describe, jest, test, expect} = require('@jest/globals')

beforeEach(() => {
    jest.useFakeTimers()
})

describe('timeout-emit', () => {
    test('should emit after timeout after receiving message', async () => {
        const timeoutEmit = require('./timeout-emit')('test-timeout-emit', {
            listenTopic: 'test-topic',
            timeout: 1000,
            emitTopic: 'emit-topic',
            emitValue: 'timeout'
        })
        const subscribe = jest.fn()
        const publish = jest.fn()
        const mqtt = {subscribe, publish}

        // start the bot
        await timeoutEmit.start({ mqtt })
        expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

        // check for timeout after start
        jest.advanceTimersByTime(1000)
        expect(publish).not.toHaveBeenCalled()

        // receive a message
        subscribe.mock.calls[0][1]('payload')
        expect(publish).not.toHaveBeenCalled()

        // check for timeout after message
        jest.advanceTimersByTime(1000)
        expect(publish).toHaveBeenCalledWith('emit-topic', 'timeout')

        // check for timeout after emit
        publish.mockClear()
        jest.advanceTimersByTime(1000)
        expect(publish).not.toHaveBeenCalled()
    })

    test('should emit after timout after first received message within timeout', async () => {
        const timeoutEmit = require('./timeout-emit')('test-timeout-emit', {
            listenTopic: 'test-topic',
            timeout: 1000,
            emitTopic: 'emit-topic',
            emitValue: 'timeout'
        })
        const subscribe = jest.fn()
        const publish = jest.fn()
        const mqtt = {subscribe, publish}

        // start the bot
        await timeoutEmit.start({ mqtt })
        expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

        // receive a message
        subscribe.mock.calls[0][1]('payload')
        expect(publish).not.toHaveBeenCalled()

        // advance with half of the timeout
        jest.advanceTimersByTime(500)
        expect(publish).not.toHaveBeenCalled()

        // receive a message
        subscribe.mock.calls[0][1]('payload')
        expect(publish).not.toHaveBeenCalled()

        // advance with half of the timeout
        jest.advanceTimersByTime(500)
        expect(publish).toHaveBeenCalledWith('emit-topic', 'timeout')

        // check for timeout after emit
        publish.mockClear()
        jest.advanceTimersByTime(1000)
        expect(publish).not.toHaveBeenCalled()
    })

    test('should emit after timeout after receiving message with filter', async () => {
        const timeoutEmit = require('./timeout-emit')('test-timeout-emit', {
            listenTopic: 'test-topic',
            listenFilter: (payload) => payload === 'valid',
            timeout: 1000,
            emitTopic: 'emit-topic',
            emitValue: 'timeout'
        })
        const subscribe = jest.fn()
        const publish = jest.fn()
        const mqtt = {subscribe, publish}

        // start the bot
        await timeoutEmit.start({ mqtt })
        expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

        // receive an invalid message
        subscribe.mock.calls[0][1]('invalid')
        expect(publish).not.toHaveBeenCalled()

        // check for timeout after invalid message
        jest.advanceTimersByTime(1000)
        expect(publish).not.toHaveBeenCalled()

        // receive a valid message
        subscribe.mock.calls[0][1]('valid')
        expect(publish).not.toHaveBeenCalled()

        // check for timeout after message
        jest.advanceTimersByTime(1000)
        expect(publish).toHaveBeenCalledWith('emit-topic', 'timeout')

        // check for timeout after emit
        publish.mockClear()
        jest.advanceTimersByTime(1000)
        expect(publish).not.toHaveBeenCalled()
    })

    test('should not emit after receiving message with filter false', async () => {
        const timeoutEmit = require('./timeout-emit')('test-timeout-emit', {
            listenTopic: 'test-topic',
            listenFilter: (payload) => payload === 'valid',
            timeout: 1000,
            emitTopic: 'emit-topic',
            emitValue: 'timeout'
        })
        const subscribe = jest.fn()
        const publish = jest.fn()
        const mqtt = {subscribe, publish}

        // start the bot
        await timeoutEmit.start({ mqtt })
        expect(subscribe).toHaveBeenCalledWith('test-topic', expect.any(Function))

        // receive an invalid message
        subscribe.mock.calls[0][1]('valid')
        expect(publish).not.toHaveBeenCalled()

        // check for timeout after invalid message
        jest.advanceTimersByTime(500)
        expect(publish).not.toHaveBeenCalled()

        // receive an invalid message
        subscribe.mock.calls[0][1]('invalid')
        expect(publish).not.toHaveBeenCalled()

        // check for timeout after invalid message
        jest.advanceTimersByTime(1000)
        expect(publish).not.toHaveBeenCalled()
    })
})
