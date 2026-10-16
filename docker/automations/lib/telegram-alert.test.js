const {describe, expect, it, jest} = require('@jest/globals')
const telegramAlert = require('./telegram-alert')

describe('telegramAlert', () => {
  it('posts the source and message to telegram-bridge', async () => {
    const httpPost = jest.fn().mockResolvedValue({ok: true})

    await telegramAlert({httpPost})('boilerController', 'hello')

    expect(httpPost).toHaveBeenCalledWith('http://telegram-bridge:3000/webhook', {source: 'boilerController', message: 'hello'})
  })

  it('logs a failed post and does not throw', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    const httpPost = jest.fn().mockRejectedValue(new Error('getaddrinfo EAI_AGAIN'))

    await expect(telegramAlert({httpPost})('boilerController', 'hello')).resolves.toBeUndefined()

    expect(errors.mock.calls[0].join(' ')).toContain('EAI_AGAIN')
  })

  it('logs a post the bridge refused', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => {})
    const httpPost = jest.fn().mockResolvedValue({ok: false, status: 502})

    await telegramAlert({httpPost})('boilerController', 'hello')

    expect(errors.mock.calls[0].join(' ')).toContain('502')
  })
})
