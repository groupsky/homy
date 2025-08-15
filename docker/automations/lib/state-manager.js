const fs = require('fs').promises
const path = require('path')

class StateManager {
  constructor(stateDir = process.env.STATE_DIR || '/app/state') {
    this.stateDir = stateDir
    this.cache = new Map()
    this.writeTimeouts = new Map()
    this.debounceMs = 100
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
    await this._ensureStateDir()
    const statePath = this._getStatePath(botName)
    const tempPath = `${statePath}.tmp`

    try {
      await fs.writeFile(tempPath, JSON.stringify(state, null, 2), 'utf8')
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

  createBotState(botName) {
    return {
      get: async (defaultState = {})=> {
        await this._ensureCached(botName)
        const cachedState = this.cache.get(botName)
        return cachedState !== null ? cachedState : defaultState
      },

      set: async (newState) => {
        this.cache.set(botName, newState)
        this._debouncedSave(botName, newState)
      }
    }
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
  }
}

module.exports = StateManager
