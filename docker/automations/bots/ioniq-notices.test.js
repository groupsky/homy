const { describe, test, expect, jest, beforeEach, afterEach } = require('@jest/globals')
const createBot = require('./ioniq-notices')

const TOPIC = 'homy/ioniq/notice'
const notice = (extra = {}) => ({ id: 'plug-2026-11-28', kind: 'plug_check', time: '2026-11-28T20:30:00Z', text: 'Колата е вкъщи и не е включена', ...extra })

const startBot = async ({ cache, httpPost = jest.fn().mockResolvedValue({ ok: true }), config = {} } = {}) => {
  const subscriptions = new Map()
  const mqtt = {
    subscribe: jest.fn(async (topic, callback, options) => { subscriptions.set(topic, { callback, options }) }),
    publish: jest.fn()
  }
  const bot = createBot('ioniqNotices', { ...config, httpPost })
  const persistedCache = cache ?? structuredClone(bot.persistedCache.default)
  await bot.start({ mqtt, persistedCache })
  return {
    persistedCache,
    httpPost,
    subscription: subscriptions.get(TOPIC),
    deliver: (payload) => subscriptions.get(TOPIC).callback(payload)
  }
}

let logSpy, errorSpy
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => jest.restoreAllMocks())

describe('ioniq-notices', () => {
  test('subscribes to the notice topic with QoS 1', async () => {
    const bot = await startBot()
    expect(bot.subscription.options).toEqual({ qos: 1 })
  })

  test('sends a notice once, as source ioniq-notices', async () => {
    const bot = await startBot()
    await bot.deliver(notice())
    expect(bot.httpPost).toHaveBeenCalledTimes(1)
    expect(bot.httpPost).toHaveBeenCalledWith('http://telegram-bridge:3000/webhook', {
      source: 'ioniq-notices', message: 'Колата е вкъщи и не е включена'
    })
  })

  test('does not send the same id again', async () => {
    const bot = await startBot()
    await bot.deliver(notice())
    await bot.deliver(notice())
    expect(bot.httpPost).toHaveBeenCalledTimes(1)
  })

  test('does not send an id sent before a restart', async () => {
    const first = await startBot()
    await first.deliver(notice())
    const second = await startBot({ cache: structuredClone(first.persistedCache) })
    await second.deliver(notice())
    expect(second.httpPost).not.toHaveBeenCalled()
  })

  test('sends a notice with a new id', async () => {
    const bot = await startBot()
    await bot.deliver(notice())
    await bot.deliver(notice({ id: 'plug-2026-11-29' }))
    expect(bot.httpPost).toHaveBeenCalledTimes(2)
  })

  test('keeps only the last maxIds ids', async () => {
    const bot = await startBot({ config: { maxIds: 3 } })
    for (const id of ['a', 'b', 'c', 'd']) await bot.deliver(notice({ id }))
    expect(bot.persistedCache.ids).toEqual(['b', 'c', 'd'])
  })

  test.each([
    ['no id', notice({ id: undefined })],
    ['no text', notice({ text: undefined })],
    ['empty text', notice({ text: '  ' })],
    ['not an object', 'hello'],
    ['null', null]
  ])('drops a message with %s, with one log line', async (_, payload) => {
    const bot = await startBot()
    await bot.deliver(payload)
    expect(bot.httpPost).not.toHaveBeenCalled()
    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy.mock.calls[0][0]).toContain('dropped')
  })

  test('logs a failed bridge call and keeps working', async () => {
    const httpPost = jest.fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValue({ ok: true })
    const bot = await startBot({ httpPost })
    await expect(bot.deliver(notice())).resolves.toBeUndefined()
    expect(errorSpy).toHaveBeenCalledWith('[ioniq-notices] failed to send the alert:', 'connect ECONNREFUSED')
    await bot.deliver(notice({ id: 'next' }))
    expect(httpPost).toHaveBeenCalledTimes(2)
  })

  test('logs a refused bridge call', async () => {
    const bot = await startBot({ httpPost: jest.fn().mockResolvedValue({ ok: false, status: 500 }) })
    await bot.deliver(notice())
    expect(errorSpy).toHaveBeenCalledWith('[ioniq-notices] telegram-bridge refused the alert: HTTP 500')
  })
})
