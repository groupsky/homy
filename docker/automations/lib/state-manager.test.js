const fs = require('fs').promises
const path = require('path')
const StateManager = require('./state-manager')
const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')

const TEST_STATE_DIR = '/tmp/state-manager-test'

describe('StateManager', () => {
  let stateManager

  beforeEach(async () => {
    await fs.rm(TEST_STATE_DIR, { recursive: true, force: true })
    stateManager = new StateManager(TEST_STATE_DIR)
  })

  afterEach(async () => {
    if (stateManager) {
      await stateManager.cleanup()
    }
    await fs.rm(TEST_STATE_DIR, { recursive: true, force: true })
  })

  describe('constructor', () => {
    it('should use default state directory when not provided', () => {
      const defaultManager = new StateManager()
      expect(defaultManager.stateDir).toBe('/app/state')
    })

    it('should use STATE_DIR environment variable when provided', () => {
      const originalEnv = process.env.STATE_DIR
      process.env.STATE_DIR = '/custom/state'
      const envManager = new StateManager()
      expect(envManager.stateDir).toBe('/custom/state')
      process.env.STATE_DIR = originalEnv
    })

    it('should use provided state directory parameter', () => {
      const customManager = new StateManager('/custom/path')
      expect(customManager.stateDir).toBe('/custom/path')
    })
  })

  describe('createBotState', () => {
    it('should create scoped state for a bot', () => {
      const botState = stateManager.createBotState('test-bot')
      expect(botState).toHaveProperty('get')
      expect(botState).toHaveProperty('set')
      expect(typeof botState.get).toBe('function')
      expect(typeof botState.set).toBe('function')
    })

    it('should return default state when no state exists', async () => {
      const botState = stateManager.createBotState('new-bot')
      const defaultState = { count: 0, enabled: true }
      const state = await botState.get(defaultState)
      expect(state).toEqual(defaultState)
    })

    it('should return empty object as default when no default provided', async () => {
      const botState = stateManager.createBotState('new-bot')
      const state = await botState.get()
      expect(state).toEqual({})
    })
  })

  describe('state persistence', () => {
    it('should persist state to filesystem', async () => {
      const botState = stateManager.createBotState('persistent-bot')
      const testState = { count: 42, name: 'test' }

      await botState.set(testState)
      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'persistent-bot.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState).toEqual(testState)
    })

    it('should load persisted state from filesystem', async () => {
      const testState = { count: 99, settings: { theme: 'dark' } }
      const statePath = path.join(TEST_STATE_DIR, 'loaded-bot.json')

      await fs.mkdir(TEST_STATE_DIR, { recursive: true })
      await fs.writeFile(statePath, JSON.stringify(testState), 'utf8')

      const botState = stateManager.createBotState('loaded-bot')
      const loadedState = await botState.get()

      expect(loadedState).toEqual(testState)
    })

    it('should create state directory if it does not exist', async () => {
      const botState = stateManager.createBotState('test-bot')
      await botState.set({ test: true })
      await stateManager.flushAll()

      const dirExists = await fs.access(TEST_STATE_DIR).then(() => true).catch(() => false)
      expect(dirExists).toBe(true)
    })
  })

  describe('debouncing', () => {
    it('should debounce rapid state changes', async () => {
      const botState = stateManager.createBotState('debounce-bot')
      const writeFileSpy = jest.spyOn(fs, 'writeFile')

      await botState.set({ count: 1 })
      await botState.set({ count: 2 })
      await botState.set({ count: 3 })

      await new Promise(resolve => setTimeout(resolve, 50))
      expect(writeFileSpy).not.toHaveBeenCalled()

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(writeFileSpy).toHaveBeenCalledTimes(1)

      writeFileSpy.mockRestore()
    })

    it('should use latest state after debouncing', async () => {
      const botState = stateManager.createBotState('latest-bot')

      await botState.set({ count: 1 })
      await botState.set({ count: 2 })
      await botState.set({ count: 3 })

      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'latest-bot.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState).toEqual({ count: 3 })
    })
  })

  describe('atomic writes', () => {
    it('should use temporary file for atomic writes', async () => {
      const botState = stateManager.createBotState('atomic-bot')
      const renameSpy = jest.spyOn(fs, 'rename')

      await botState.set({ atomic: true })
      await stateManager.flushAll()

      expect(renameSpy).toHaveBeenCalledWith(
        path.join(TEST_STATE_DIR, 'atomic-bot.json.tmp'),
        path.join(TEST_STATE_DIR, 'atomic-bot.json')
      )

      renameSpy.mockRestore()
    })

    it('should clean up temp file on write error', async () => {
      const botState = stateManager.createBotState('error-bot')
      const writeFileError = new Error('Write failed')
      const writeFileSpy = jest.spyOn(fs, 'writeFile').mockRejectedValue(writeFileError)
      const unlinkSpy = jest.spyOn(fs, 'unlink').mockResolvedValue()

      await expect(stateManager._saveToDisk('error-bot', { test: true })).rejects.toThrow('Write failed')

      expect(unlinkSpy).toHaveBeenCalledWith(path.join(TEST_STATE_DIR, 'error-bot.json.tmp'))

      writeFileSpy.mockRestore()
      unlinkSpy.mockRestore()
    })
  })

  describe('cache behavior', () => {
    it('should cache state in memory after first load', async () => {
      const readFileSpy = jest.spyOn(fs, 'readFile')
      const botState = stateManager.createBotState('cached-bot')

      await botState.get({ initial: true })
      await botState.get({ initial: true })
      await botState.get({ initial: true })

      expect(readFileSpy).toHaveBeenCalledTimes(1)

      readFileSpy.mockRestore()
    })

    it('should update cache when setting new state', async () => {
      const botState = stateManager.createBotState('cache-update-bot')

      await botState.set({ version: 1 })
      const state1 = await botState.get()
      expect(state1).toEqual({ version: 1 })

      await botState.set({ version: 2 })
      const state2 = await botState.get()
      expect(state2).toEqual({ version: 2 })
    })
  })

  describe('multiple bots', () => {
    it('should isolate state between different bots', async () => {
      const bot1State = stateManager.createBotState('bot1')
      const bot2State = stateManager.createBotState('bot2')

      await bot1State.set({ bot: 'first', value: 100 })
      await bot2State.set({ bot: 'second', value: 200 })

      const state1 = await bot1State.get()
      const state2 = await bot2State.get()

      expect(state1).toEqual({ bot: 'first', value: 100 })
      expect(state2).toEqual({ bot: 'second', value: 200 })
    })

    it('should create separate files for different bots', async () => {
      const bot1State = stateManager.createBotState('file-bot1')
      const bot2State = stateManager.createBotState('file-bot2')

      await bot1State.set({ id: 1 })
      await bot2State.set({ id: 2 })
      await stateManager.flushAll()

      const file1Exists = await fs.access(path.join(TEST_STATE_DIR, 'file-bot1.json')).then(() => true).catch(() => false)
      const file2Exists = await fs.access(path.join(TEST_STATE_DIR, 'file-bot2.json')).then(() => true).catch(() => false)

      expect(file1Exists).toBe(true)
      expect(file2Exists).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('should flush all pending writes on cleanup', async () => {
      const bot1State = stateManager.createBotState('cleanup-bot1')
      const bot2State = stateManager.createBotState('cleanup-bot2')

      await bot1State.set({ cleanup: 1 })
      await bot2State.set({ cleanup: 2 })

      await stateManager.cleanup()

      const file1Data = await fs.readFile(path.join(TEST_STATE_DIR, 'cleanup-bot1.json'), 'utf8')
      const file2Data = await fs.readFile(path.join(TEST_STATE_DIR, 'cleanup-bot2.json'), 'utf8')

      expect(JSON.parse(file1Data)).toEqual({ cleanup: 1 })
      expect(JSON.parse(file2Data)).toEqual({ cleanup: 2 })
    })

    it('should clear cache on cleanup', async () => {
      const botState = stateManager.createBotState('cache-clear-bot')
      await botState.set({ cached: true })

      expect(stateManager.cache.size).toBeGreaterThan(0)

      await stateManager.cleanup()

      expect(stateManager.cache.size).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should handle missing state files gracefully', async () => {
      const botState = stateManager.createBotState('missing-bot')
      const defaultState = { missing: true }

      const state = await botState.get(defaultState)
      expect(state).toEqual(defaultState)
    })

    it('should handle invalid JSON gracefully', async () => {
      const statePath = path.join(TEST_STATE_DIR, 'invalid-bot.json')
      await fs.mkdir(TEST_STATE_DIR, { recursive: true })
      await fs.writeFile(statePath, 'invalid json{', 'utf8')

      await expect(stateManager._loadFromDisk('invalid-bot')).rejects.toThrow()
    })

    it('should log errors during debounced saves', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation()
      const writeFileSpy = jest.spyOn(fs, 'writeFile').mockRejectedValue(new Error('Disk full'))

      const botState = stateManager.createBotState('error-save-bot')
      await botState.set({ test: true })

      await new Promise(resolve => setTimeout(resolve, 150))

      expect(consoleSpy).toHaveBeenCalledWith(
        '[StateManager] Failed to save state for bot error-save-bot:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
      writeFileSpy.mockRestore()
    })
  })
})
