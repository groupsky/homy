const fs = require('fs').promises
const path = require('path')
const { reactive, watch } = require('@vue/reactivity')
const stringify = require('fast-json-stable-stringify')

function handleStateMigration(botName, cachedData, version, defaultState, migrate) {
  if (cachedData === null) {
    return structuredClone(defaultState)
  }

  const { version: cachedVersion = 1, default: cachedDefault = {}, state: cachedState = {} } = cachedData
  const needsMigration = cachedVersion !== version ||
                        stringify(cachedDefault) !== stringify(defaultState)

  if (!needsMigration) {
    return structuredClone(cachedState || {})
  }

  if (!migrate) {
    console.warn(`[StateManager] Bot ${botName} version/default changed but no migrate function provided, discarding saved state`)
    return structuredClone(defaultState)
  }

  try {
    const migratedState = migrate({ version, defaultState, state: structuredClone(cachedState || {}) })
    return structuredClone(migratedState)
  } catch (error) {
    console.warn(`[StateManager] Migration failed for bot ${botName}, using default state:`, error)
    return structuredClone(defaultState)
  }
}

class StateManager {
  constructor({stateDir = process.env.STATE_DIR || '/app/state', debounceMs = 100, enabled = true} = {}) {
    this.stateDir = stateDir
    this.cache = new Map()
    this.reactiveStates = new Map()
    this.writeTimeouts = new Map()
    this.debounceMs = debounceMs
    this.enabled = enabled
  }

  async _ensureStateDir() {
    try {
      await fs.access(this.stateDir)
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(this.stateDir, { recursive: true })
      } else {
        throw error
      }
    }
  }

  _getStatePath(botName) {
    return path.join(this.stateDir, `${botName}.json`)
  }

  async _loadFromDisk(botName) {
    if (!this.enabled) {
      return null
    }
    const statePath = this._getStatePath(botName)
    try {
      const data = await fs.readFile(statePath, 'utf8')
      return JSON.parse(data)
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null
      }
      throw error
    }
  }

  async _saveToDisk(botName, state) {
    if (!this.enabled) {
      return
    }
    await this._ensureStateDir()
    const statePath = this._getStatePath(botName)
    const tempPath = `${statePath}.tmp`

    try {
      await fs.writeFile(tempPath, stringify(state, { space: 2 }), 'utf8')
      await fs.rename(tempPath, statePath)
    } catch (error) {
      try {
        await fs.unlink(tempPath)
      } catch (unlinkError) {
      }
      throw error
    }
  }

  _debouncedSave(botName, state) {
    if (!this.enabled) {
      return
    }
    if (this.writeTimeouts.has(botName)) {
      clearTimeout(this.writeTimeouts.get(botName))
    }

    const timeoutId = setTimeout(async () => {
      try {
        await this._saveToDisk(botName, state)
        this.writeTimeouts.delete(botName)
      } catch (error) {
        console.error(`[StateManager] Failed to save state for bot ${botName}:`, error)
      }
    }, this.debounceMs)

    this.writeTimeouts.set(botName, timeoutId)
  }

  async _ensureCached(botName) {
    if (!this.cache.has(botName)) {
      const diskState = await this._loadFromDisk(botName)
      this.cache.set(botName, diskState)
    }
  }

  async createBotState(botName, defaultState = {}, version = 1, migrate = null) {
    const cacheKey = `${botName}-${version}-${stringify(defaultState)}`

    if (this.reactiveStates.has(cacheKey)) {
      return this.reactiveStates.get(cacheKey)
    }

    await this._ensureCached(botName)
    const cachedData = this.cache.get(botName)
    const userState = handleStateMigration(botName, cachedData, version, defaultState, migrate)

    const reactiveState = reactive(userState)

    watch(
      () => reactiveState,
      (newState) => {
        const plainState = JSON.parse(stringify(newState))
        const dataWithMetadata = { version, default: defaultState, state: plainState }
        this.cache.set(botName, structuredClone(dataWithMetadata))
        this._debouncedSave(botName, structuredClone(dataWithMetadata))
      },
      { deep: true, flush: 'sync' }
    )

    this.reactiveStates.set(cacheKey, reactiveState)
    return reactiveState
  }


  async flushAll() {
    const flushPromises = []

    for (const [botName, timeoutId] of this.writeTimeouts) {
      clearTimeout(timeoutId)
      const state = this.cache.get(botName)
      if (state !== null && state !== undefined) {
        flushPromises.push(this._saveToDisk(botName, state))
      }
    }

    this.writeTimeouts.clear()
    await Promise.all(flushPromises)
  }

  async cleanup() {
    await this.flushAll()
    this.cache.clear()
    this.reactiveStates.clear()
  }
}

module.exports = StateManager
