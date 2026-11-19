const {describe, expect, it, jest} = require('@jest/globals')
const createShutdown = require('./shutdown')

const setup = (clients, options = {}) => {
  const events = []
  const exit = jest.fn((code) => events.push(`exit ${code}`))
  const shutdown = createShutdown({
    integrations: clients.map((client, i) => ({client, name: `i${i}`})),
    stopPolling: () => events.push('stop polling'),
    exit,
    log: () => {},
    ...options,
  })
  return {events, exit, shutdown}
}

describe('shutdown', () => {
  it('stops polling, flushes every integration, then exits 0', async () => {
    const closed = []
    const {events, exit, shutdown} = setup([
      {close: async () => { await Promise.resolve(); closed.push('a'); events.push('closed a') }},
      {publish: () => {}},
      {close: async () => { closed.push('b'); events.push('closed b') }},
    ])

    await shutdown('SIGTERM')

    expect(closed.sort()).toEqual(['a', 'b'])
    expect(events[0]).toBe('stop polling')
    expect(events[events.length - 1]).toBe('exit 0')
    expect(exit).toHaveBeenCalledTimes(1)
  })

  it('does not exit before a slow flush is done', async () => {
    let done = false
    const {exit, shutdown} = setup([
      {close: () => new Promise((resolve) => setTimeout(() => { done = true; resolve() }, 50))},
    ])

    await shutdown('SIGINT')

    expect(done).toBe(true)
    expect(exit).toHaveBeenCalledWith(0)
  })

  it('exits after the timeout when an integration is stuck', async () => {
    const {exit, shutdown} = setup([{close: () => new Promise(() => {})}], {msTimeout: 50})
    const start = Date.now()

    await shutdown('SIGTERM')

    expect(Date.now() - start).toBeLessThan(1000)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('still flushes the others and exits when one close fails', async () => {
    const good = jest.fn(async () => {})
    const {exit, shutdown} = setup([
      {close: async () => { throw new Error('boom') }},
      {close: good},
    ])

    await shutdown('SIGTERM')

    expect(good).toHaveBeenCalled()
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('runs once when signalled twice', async () => {
    const close = jest.fn(async () => {})
    const {exit, shutdown} = setup([{close}])

    await Promise.all([shutdown('SIGTERM'), shutdown('SIGINT')])

    expect(close).toHaveBeenCalledTimes(1)
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
