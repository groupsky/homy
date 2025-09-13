const fs = require('fs').promises
const path = require('path')
const StateManager = require('./state-manager')
const {afterEach, beforeEach, describe, expect, it, jest, test} = require('@jest/globals')

const TEST_STATE_DIR = '/tmp/state-manager-test'

describe('StateManager', () => {
  let stateManager

  beforeEach(async () => {
    await fs.rm(TEST_STATE_DIR, { recursive: true, force: true })
    stateManager = new StateManager({stateDir: TEST_STATE_DIR})
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
      const customManager = new StateManager({stateDir: '/custom/path'})
      expect(customManager.stateDir).toBe('/custom/path')
    })

    it('should be enabled by default', () => {
      const defaultManager = new StateManager()
      expect(defaultManager.enabled).toBe(true)
    })

    it('should accept enabled parameter in constructor', () => {
      const enabledManager = new StateManager({enabled: true})
      expect(enabledManager.enabled).toBe(true)

      const disabledManager = new StateManager({enabled: false})
      expect(disabledManager.enabled).toBe(false)
    })
  })

  describe('direct cache creation', () => {
    it('should create reactive cache with config directly', async () => {
      const defaultState = { count: 5, items: [] }
      const migrate = ({ version, defaultState, state }) => {
        return { ...state, migrated: true }
      }

      const persistedCache = await stateManager.createBotState('config-test', defaultState, 2, migrate)

      expect(persistedCache.count).toBe(5)
      expect(persistedCache.items).toEqual([])

      persistedCache.count = 10
      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'config-test.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState).toEqual({
        version: 2,
        default: { count: 5, items: [] },
        state: { count: 10, items: [] }
      })
    })
  })

  describe('createBotState (legacy)', () => {
    it('should create reactive state for a bot', async () => {
      const defaultState = { count: 0, enabled: true }
      const botState = await stateManager.createBotState('test-bot', defaultState)

      expect(botState).toEqual(defaultState)
      expect(typeof botState).toBe('object')
    })

    it('should return default state when no state exists', async () => {
      const defaultState = { count: 0, enabled: true }
      const botState = await stateManager.createBotState('new-bot', defaultState)
      expect(botState).toEqual(defaultState)
    })

    it('should return empty object as default when no default provided', async () => {
      const botState = await stateManager.createBotState('new-bot')
      expect(botState).toEqual({})
    })

    it('should make state reactive - mutations trigger persistence', async () => {
      const botState = await stateManager.createBotState('reactive-bot', { count: 0 })

      // Mutate the state
      botState.count = 42
      botState.name = 'test'

      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'reactive-bot.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState).toEqual({ version: 1, default: { count: 0 }, state: { count: 42, name: 'test' } })
    })
  })

  describe('state persistence', () => {
    it('should persist state to filesystem when properties change', async () => {
      const botState = await stateManager.createBotState('persistent-bot', { count: 0 })

      botState.count = 42
      botState.name = 'test'

      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'persistent-bot.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState).toEqual({ version: 1, default: { count: 0 }, state: { count: 42, name: 'test' } })
    })

    it('should load persisted state from filesystem', async () => {
      const testState = { count: 99, settings: { theme: 'dark' } }
      const fileData = { version: 1, default: {}, state: testState }
      const statePath = path.join(TEST_STATE_DIR, 'loaded-bot.json')

      await fs.mkdir(TEST_STATE_DIR, { recursive: true })
      await fs.writeFile(statePath, JSON.stringify(fileData), 'utf8')

      const botState = await stateManager.createBotState('loaded-bot')
      expect(botState).toEqual(testState)
    })

    it('should create state directory if it does not exist', async () => {
      const botState = await stateManager.createBotState('test-bot', { test: true })
      botState.test = false
      await stateManager.flushAll()

      const dirExists = await fs.access(TEST_STATE_DIR).then(() => true).catch(() => false)
      expect(dirExists).toBe(true)
    })
  })

  describe('reactive behavior', () => {
    it('should trigger persistence on nested object changes', async () => {
      const botState = await stateManager.createBotState('nested-bot', {
        user: { name: 'John', settings: { theme: 'light' } }
      })

      botState.user.name = 'Jane'
      botState.user.settings.theme = 'dark'

      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'nested-bot.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState.state.user.name).toBe('Jane')
      expect(parsedState.state.user.settings.theme).toBe('dark')
    })

    it('should trigger persistence on array changes', async () => {
      const botState = await stateManager.createBotState('array-bot', {
        items: ['a', 'b', 'c'],
        counts: [1, 2, 3]
      })

      botState.items[0] = 'changed'
      botState.items.push('d')
      botState.counts[1] = 99

      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'array-bot.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState.state.items).toEqual(['changed', 'b', 'c', 'd'])
      expect(parsedState.state.counts).toEqual([1, 99, 3])
    })
  })

  describe('debouncing', () => {
    it('should debounce rapid state changes', async () => {
      const writeFileSpy = jest.spyOn(fs, 'writeFile')
      const botState = await stateManager.createBotState('debounce-bot', { count: 0 })

      botState.count = 1
      botState.count = 2
      botState.count = 3

      await new Promise(resolve => setTimeout(resolve, 50))
      expect(writeFileSpy).not.toHaveBeenCalled()

      await new Promise(resolve => setTimeout(resolve, 100))
      expect(writeFileSpy).toHaveBeenCalledTimes(1)

      writeFileSpy.mockRestore()
    })

    it('should use latest state after debouncing', async () => {
      const botState = await stateManager.createBotState('latest-bot', { count: 0 })

      botState.count = 1
      botState.count = 2
      botState.count = 3

      await stateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'latest-bot.json')
      const savedData = await fs.readFile(statePath, 'utf8')
      const parsedState = JSON.parse(savedData)

      expect(parsedState).toEqual({ version: 1, default: { count: 0 }, state: { count: 3 } })
    })
  })

  describe('atomic writes', () => {
    it('should use temporary file for atomic writes', async () => {
      const renameSpy = jest.spyOn(fs, 'rename')
      const botState = await stateManager.createBotState('atomic-bot', { atomic: false })

      botState.atomic = true
      await stateManager.flushAll()

      expect(renameSpy).toHaveBeenCalledWith(
        path.join(TEST_STATE_DIR, 'atomic-bot.json.tmp'),
        path.join(TEST_STATE_DIR, 'atomic-bot.json')
      )

      renameSpy.mockRestore()
    })

    it('should clean up temp file on write error', async () => {
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

      await stateManager.createBotState('cached-bot', { initial: true })
      await stateManager.createBotState('cached-bot', { initial: true })
      await stateManager.createBotState('cached-bot', { initial: true })

      expect(readFileSpy).toHaveBeenCalledTimes(1)

      readFileSpy.mockRestore()
    })

    it('should return same reactive instance for multiple createBotState calls with same params', async () => {
      const botState1 = await stateManager.createBotState('same-instance-bot', { count: 0 })
      const botState2 = await stateManager.createBotState('same-instance-bot', { count: 0 })

      expect(botState1).toBe(botState2)

      botState1.count = 42
      expect(botState2.count).toBe(42)
    })

    it('should return different reactive instance for different defaults', async () => {
      const botState1 = await stateManager.createBotState('different-defaults-bot', { count: 0 })
      const botState2 = await stateManager.createBotState('different-defaults-bot', { differentDefault: true })

      expect(botState1).not.toBe(botState2)
      expect(botState1.count).toBe(0)
      expect(botState2.differentDefault).toBe(true)
    })

    it('should reflect changes immediately in reactive state', async () => {
      const botState = await stateManager.createBotState('immediate-bot', { version: 1 })

      expect(botState.version).toBe(1)

      botState.version = 2
      expect(botState.version).toBe(2)

      botState.version = 3
      expect(botState.version).toBe(3)
    })
  })

  describe('multiple bots', () => {
    it('should isolate state between different bots', async () => {
      const bot1State = await stateManager.createBotState('bot1', { bot: 'first', value: 0 })
      const bot2State = await stateManager.createBotState('bot2', { bot: 'second', value: 0 })

      bot1State.value = 100
      bot2State.value = 200

      expect(bot1State).toEqual({ bot: 'first', value: 100 })
      expect(bot2State).toEqual({ bot: 'second', value: 200 })
    })

    it('should create separate files for different bots', async () => {
      const bot1State = await stateManager.createBotState('file-bot1', { id: 0 })
      const bot2State = await stateManager.createBotState('file-bot2', { id: 0 })

      bot1State.id = 1
      bot2State.id = 2
      await stateManager.flushAll()

      const file1Exists = await fs.access(path.join(TEST_STATE_DIR, 'file-bot1.json')).then(() => true).catch(() => false)
      const file2Exists = await fs.access(path.join(TEST_STATE_DIR, 'file-bot2.json')).then(() => true).catch(() => false)

      expect(file1Exists).toBe(true)
      expect(file2Exists).toBe(true)
    })
  })

  describe('cleanup', () => {
    it('should flush all pending writes on cleanup', async () => {
      const bot1State = await stateManager.createBotState('cleanup-bot1', { cleanup: 0 })
      const bot2State = await stateManager.createBotState('cleanup-bot2', { cleanup: 0 })

      bot1State.cleanup = 1
      bot2State.cleanup = 2

      await stateManager.cleanup()

      const file1Data = await fs.readFile(path.join(TEST_STATE_DIR, 'cleanup-bot1.json'), 'utf8')
      const file2Data = await fs.readFile(path.join(TEST_STATE_DIR, 'cleanup-bot2.json'), 'utf8')

      expect(JSON.parse(file1Data)).toEqual({ version: 1, default: { cleanup: 0 }, state: { cleanup: 1 } })
      expect(JSON.parse(file2Data)).toEqual({ version: 1, default: { cleanup: 0 }, state: { cleanup: 2 } })
    })

    it('should clear cache on cleanup', async () => {
      const botState = await stateManager.createBotState('cache-clear-bot', { cached: true })
      botState.cached = false

      expect(stateManager.cache.size).toBeGreaterThan(0)

      await stateManager.cleanup()

      expect(stateManager.cache.size).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should handle missing state files gracefully', async () => {
      const defaultState = { missing: true }
      const botState = await stateManager.createBotState('missing-bot', defaultState)
      expect(botState).toEqual(defaultState)
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

      const botState = await stateManager.createBotState('error-save-bot', { test: false })
      botState.test = true

      await new Promise(resolve => setTimeout(resolve, 150))

      expect(consoleSpy).toHaveBeenCalledWith(
        '[StateManager] Failed to save state for bot error-save-bot:',
        expect.any(Error)
      )

      consoleSpy.mockRestore()
      writeFileSpy.mockRestore()
    })
  })

  describe('disabled state manager', () => {
    let disabledStateManager

    beforeEach(async () => {
      await fs.rm(TEST_STATE_DIR, { recursive: true, force: true })
      disabledStateManager = new StateManager({stateDir: TEST_STATE_DIR, enabled: false})
    })

    afterEach(async () => {
      if (disabledStateManager) {
        await disabledStateManager.cleanup()
      }
      await fs.rm(TEST_STATE_DIR, { recursive: true, force: true })
    })

    it('should not save state when disabled', async () => {
      const botState = await disabledStateManager.createBotState('disabled-bot', { count: 0 })
      botState.count = 42
      botState.name = 'test'
      await disabledStateManager.flushAll()

      const statePath = path.join(TEST_STATE_DIR, 'disabled-bot.json')
      const fileExists = await fs.access(statePath).then(() => true).catch(() => false)
      expect(fileExists).toBe(false)
    })

    it('should return default state when disabled and no existing state', async () => {
      const defaultState = { count: 0, enabled: true }
      const botState = await disabledStateManager.createBotState('no-state-bot', defaultState)
      expect(botState).toEqual(defaultState)
    })

    it('should return empty object when disabled and no default provided', async () => {
      const botState = await disabledStateManager.createBotState('empty-bot')
      expect(botState).toEqual({})
    })

    it('should not load existing state from disk when disabled', async () => {
      const testState = { count: 99, settings: { theme: 'dark' } }
      const statePath = path.join(TEST_STATE_DIR, 'existing-bot.json')

      await fs.mkdir(TEST_STATE_DIR, { recursive: true })
      await fs.writeFile(statePath, JSON.stringify(testState), 'utf8')

      const defaultState = { count: 0 }
      const botState = await disabledStateManager.createBotState('existing-bot', defaultState)

      expect(botState).toEqual(defaultState)
    })

    it('should not create state directory when disabled', async () => {
      const botState = await disabledStateManager.createBotState('no-dir-bot', { test: false })
      botState.test = true
      await disabledStateManager.flushAll()

      const dirExists = await fs.access(TEST_STATE_DIR).then(() => true).catch(() => false)
      expect(dirExists).toBe(false)
    })

    it('should not debounce writes when disabled', async () => {
      const writeFileSpy = jest.spyOn(fs, 'writeFile')
      const botState = await disabledStateManager.createBotState('no-debounce-bot', { count: 0 })

      botState.count = 1
      botState.count = 2
      botState.count = 3

      await new Promise(resolve => setTimeout(resolve, 150))

      expect(writeFileSpy).not.toHaveBeenCalled()
      writeFileSpy.mockRestore()
    })

    it('should still be reactive when disabled (just no persistence)', async () => {
      const botState = await disabledStateManager.createBotState('reactive-disabled', { count: 0 })

      botState.count = 42
      expect(botState.count).toBe(42)

      botState.name = 'test'
      expect(botState.name).toBe('test')
    })
  })

  describe('state migration', () => {
    it('should migrate state when version changes', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // Create initial state with version 1
      const botState1 = await stateManager.createBotState('migration-bot', { count: 0 }, 1)
      botState1.count = 42
      await stateManager.flushAll()

      // Create new instance with version 2 and migration
      const migrate = ({ version, defaultState, state }) => {
        return { ...state, newField: 'migrated' }
      }
      const botState2 = await stateManager.createBotState('migration-bot', { count: 0, newField: 'default' }, 2, migrate)

      expect(botState2.count).toBe(42)
      expect(botState2.newField).toBe('migrated')
      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should migrate state when default changes', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // Create initial state
      const botState1 = await stateManager.createBotState('default-change-bot', { count: 0 })
      botState1.count = 42
      await stateManager.flushAll()

      // Create new instance with different default and migration
      const migrate = ({ version, defaultState, state }) => {
        return { ...state, items: defaultState.items }
      }
      const botState2 = await stateManager.createBotState('default-change-bot', { count: 0, items: [] }, 1, migrate)

      expect(botState2.count).toBe(42)
      expect(botState2.items).toEqual([])
      expect(consoleSpy).not.toHaveBeenCalled()

      consoleSpy.mockRestore()
    })

    it('should warn and discard state when no migrate function provided', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // Create initial state
      const botState1 = await stateManager.createBotState('no-migrate-bot', { count: 0 }, 1)
      botState1.count = 42
      await stateManager.flushAll()

      // Create new instance with different version but no migration
      const botState2 = await stateManager.createBotState('no-migrate-bot', { count: 0 }, 2)

      expect(botState2.count).toBe(0) // Reset to default
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[StateManager] Bot no-migrate-bot version/default changed but no migrate function provided')
      )

      consoleSpy.mockRestore()
    })

    it('should warn and use default state when migration fails', async () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation()

      // Create initial state
      const botState1 = await stateManager.createBotState('migration-error-bot', { count: 0 }, 1)
      botState1.count = 42
      await stateManager.flushAll()

      // Create new instance with failing migration
      const migrate = () => {
        throw new Error('Migration failed')
      }
      const botState2 = await stateManager.createBotState('migration-error-bot', { count: 0 }, 2, migrate)

      expect(botState2.count).toBe(0) // Reset to default
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('[StateManager] Migration failed for bot migration-error-bot'),
        expect.any(Error)
      )

      consoleSpy.mockRestore()
    })

    it('should not migrate when version and default are unchanged', async () => {
      const migrate = jest.fn()

      // Create initial state
      const botState1 = await stateManager.createBotState('no-migration-needed', { count: 0 }, 1, migrate)
      botState1.count = 42
      await stateManager.flushAll()

      // Create new instance with same version and default
      const botState2 = await stateManager.createBotState('no-migration-needed', { count: 0 }, 1, migrate)

      expect(botState2.count).toBe(42)
      expect(migrate).not.toHaveBeenCalled()
    })
  })
})