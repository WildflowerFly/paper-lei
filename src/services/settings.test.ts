import { beforeEach, describe, expect, it } from 'vitest'
import {
  SETTINGS_STORAGE_KEY,
  createDefaultSettings,
  loadSettings,
  normalizeWindowBounds,
  parseSettings,
  saveSettings,
  type SettingsState,
  type StorageLike,
} from './settings'

function memoryStorage(
  initial: Record<string, string> = {},
): StorageLike & { values: Record<string, string> } {
  const values = { ...initial }
  return {
    values,
    getItem(key) {
      return values[key] ?? null
    },
    setItem(key, value) {
      values[key] = value
    },
    removeItem(key) {
      delete values[key]
    },
  }
}

describe('settings persistence', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('round trips validated settings and keeps the previous version', () => {
    const storage = memoryStorage()
    const state = createDefaultSettings()
    state.settings.theme = 'dark'
    state.settings.layout.mode = 'source'
    expect(saveSettings(state, storage)).toBe(true)
    expect(loadSettings(storage)).toEqual({ state, issue: 'none' })

    state.settings.theme = 'light'
    saveSettings(state, storage)
    expect(JSON.parse(storage.values['markdown-studio.settings.previous']!).settings.theme).toBe(
      'dark',
    )
  })

  it('migrates the legacy flat schema and clamps unsafe values', () => {
    const migrated = parseSettings({
      theme: 'dark',
      layout: { navWidth: 9999, previewRatio: -20 },
      session: { window: { width: 1, height: 99999 } },
    })
    expect(migrated?.settings.theme).toBe('dark')
    expect(migrated?.settings.layout.navWidth).toBe(360)
    expect(migrated?.settings.layout.previewRatio).toBe(20)
    expect(migrated?.session.window.width).toBe(640)
    expect(migrated?.session.window.height).toBe(10000)
  })

  it('backs up malformed JSON without blocking startup', () => {
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: '{not-json' })
    const result = loadSettings(storage)
    expect(result.state).toEqual(createDefaultSettings())
    expect(result.issue).toBe('repaired')
    expect(Object.keys(storage.values).some((key) => key.includes('.corrupt.'))).toBe(true)
    expect(JSON.parse(storage.values[SETTINGS_STORAGE_KEY]!).settings.schemaVersion).toBe(1)
  })

  it('repairs valid JSON with an invalid schema and keeps a diagnostic backup', () => {
    const serialized = JSON.stringify({ schemaVersion: 999 })
    const storage = memoryStorage({ [SETTINGS_STORAGE_KEY]: serialized })
    const result = loadSettings(storage)
    expect(result.state).toEqual(createDefaultSettings())
    expect(result.issue).toBe('repaired')
    expect(Object.keys(storage.values).some((key) => key.includes('.corrupt.'))).toBe(true)
  })

  it('keeps a restored window visible on the remaining display', () => {
    const bounds = normalizeWindowBounds(
      { x: 3000, y: -500, width: 1600, height: 1000, maximized: false },
      [{ x: 0, y: 0, width: 1920, height: 1080 }],
    )
    expect(bounds).toMatchObject({ x: 320, y: 0, width: 1600, height: 1000 })
  })

  it('rejects unsupported schema versions', () => {
    expect(parseSettings({ settings: { schemaVersion: 2 } })).toBeNull()
  })
})

it('keeps the persisted shape independent from reactive wrappers', () => {
  const state: SettingsState = createDefaultSettings()
  expect(JSON.parse(JSON.stringify(state)).settings.schemaVersion).toBe(1)
})
