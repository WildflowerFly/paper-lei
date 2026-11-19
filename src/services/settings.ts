import { defineStore } from 'pinia'
import { ref } from 'vue'

export const SETTINGS_SCHEMA_VERSION = 1
export const SETTINGS_STORAGE_KEY = 'markdown-studio.settings'
export const SETTINGS_BACKUP_KEY = 'markdown-studio.settings.previous'
export const SETTINGS_TEMP_KEY = 'markdown-studio.settings.pending'

export type ThemePreference = 'light' | 'dark' | 'system'
export type LayoutMode = 'split' | 'preview' | 'source'

export type WindowBounds = {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}

export type WorkArea = { x: number; y: number; width: number; height: number }

export type SettingsState = {
  settings: {
    schemaVersion: number
    theme: ThemePreference
    layout: {
      navWidth: number
      previewRatio: number
      navVisible: boolean
      mode: LayoutMode
      narrowPane: 'preview' | 'source'
    }
  }
  session: {
    window: WindowBounds
    tabs: string[]
    activeDocument: string | null
    workspace: string | null
  }
  recent: string[]
  favorites: string[]
}

export type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

export type LoadResult = {
  state: SettingsState
  issue: 'none' | 'repaired' | 'unavailable'
}

const defaultWindow: WindowBounds = {
  x: 80,
  y: 80,
  width: 1440,
  height: 900,
  maximized: false,
}

export function createDefaultSettings(): SettingsState {
  return {
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      theme: 'system',
      layout: {
        navWidth: 240,
        previewRatio: 50,
        navVisible: true,
        mode: 'split',
        narrowPane: 'preview',
      },
    },
    session: {
      window: { ...defaultWindow },
      tabs: ['readme', 'notes'],
      activeDocument: 'readme',
      workspace: null,
    },
    recent: ['docs/README.md', 'docs/notes.md'],
    favorites: ['docs/README.md'],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback
}

function boundedStringList(value: unknown, fallback: string[], max: number) {
  if (!Array.isArray(value)) return [...fallback]
  return value.filter((item): item is string => typeof item === 'string').slice(0, max)
}

function migrateV0(raw: Record<string, unknown>): Record<string, unknown> {
  const oldLayout = isRecord(raw.layout) ? raw.layout : {}
  const oldSession = isRecord(raw.session) ? raw.session : {}
  return {
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      theme: raw.theme ?? 'system',
      layout: oldLayout,
    },
    session: oldSession,
    recent: raw.recent,
    favorites: raw.favorites,
  }
}

export function parseSettings(raw: unknown): SettingsState | null {
  if (!isRecord(raw)) return null
  const sourceSettings = isRecord(raw.settings) ? raw.settings : raw
  const version =
    typeof sourceSettings.schemaVersion === 'number' ? sourceSettings.schemaVersion : 0
  if (version > SETTINGS_SCHEMA_VERSION || version < 0) return null
  const migrated = version === 0 ? migrateV0(raw) : raw
  const defaults = createDefaultSettings()
  const migratedSettings = isRecord(migrated.settings) ? migrated.settings : migrated
  const layout = isRecord(migratedSettings.layout) ? migratedSettings.layout : {}
  const session = isRecord(migrated.session) ? migrated.session : {}
  const rawWindow = isRecord(session.window) ? session.window : {}
  const theme = migratedSettings.theme
  const mode = layout.mode
  const narrowPane = layout.narrowPane
  const state: SettingsState = {
    settings: {
      schemaVersion: SETTINGS_SCHEMA_VERSION,
      theme:
        theme === 'light' || theme === 'dark' || theme === 'system'
          ? theme
          : defaults.settings.theme,
      layout: {
        navWidth: boundedNumber(layout.navWidth, defaults.settings.layout.navWidth, 180, 360),
        previewRatio: boundedNumber(
          layout.previewRatio,
          defaults.settings.layout.previewRatio,
          20,
          80,
        ),
        navVisible:
          typeof layout.navVisible === 'boolean'
            ? layout.navVisible
            : defaults.settings.layout.navVisible,
        mode: mode === 'split' || mode === 'preview' || mode === 'source' ? mode : 'split',
        narrowPane: narrowPane === 'preview' || narrowPane === 'source' ? narrowPane : 'preview',
      },
    },
    session: {
      window: {
        x: boundedNumber(rawWindow.x, defaults.session.window.x, -100_000, 100_000),
        y: boundedNumber(rawWindow.y, defaults.session.window.y, -100_000, 100_000),
        width: boundedNumber(rawWindow.width, defaults.session.window.width, 640, 10_000),
        height: boundedNumber(rawWindow.height, defaults.session.window.height, 480, 10_000),
        maximized:
          typeof rawWindow.maximized === 'boolean'
            ? rawWindow.maximized
            : defaults.session.window.maximized,
      },
      tabs: boundedStringList(session.tabs, defaults.session.tabs, 50),
      activeDocument:
        typeof session.activeDocument === 'string' || session.activeDocument === null
          ? session.activeDocument
          : defaults.session.activeDocument,
      workspace: typeof session.workspace === 'string' ? session.workspace : null,
    },
    recent: boundedStringList(migrated.recent, defaults.recent, 50),
    favorites: boundedStringList(migrated.favorites, defaults.favorites, 50),
  }
  if (state.session.activeDocument && !state.session.tabs.includes(state.session.activeDocument)) {
    state.session.activeDocument = state.session.tabs[0] ?? null
  }
  return state
}

export function loadSettings(storage: StorageLike | null = getBrowserStorage()): LoadResult {
  const defaults = createDefaultSettings()
  if (!storage) return { state: defaults, issue: 'unavailable' }
  try {
    const serialized = storage.getItem(SETTINGS_STORAGE_KEY)
    if (!serialized) return { state: defaults, issue: 'none' }
    let decoded: unknown
    try {
      decoded = JSON.parse(serialized)
    } catch {
      repairSettings(storage, serialized, defaults)
      return { state: defaults, issue: 'repaired' }
    }
    const parsed = parseSettings(decoded)
    if (parsed) return { state: parsed, issue: 'none' }
    repairSettings(storage, serialized, defaults)
    return { state: defaults, issue: 'repaired' }
  } catch {
    return { state: defaults, issue: 'unavailable' }
  }
}

function repairSettings(storage: StorageLike, invalidValue: string, defaults: SettingsState) {
  try {
    storage.setItem(`${SETTINGS_STORAGE_KEY}.corrupt.${Date.now()}`, invalidValue)
    storage.setItem(SETTINGS_TEMP_KEY, JSON.stringify(defaults))
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(defaults))
    storage.removeItem(SETTINGS_TEMP_KEY)
  } catch {
    // A storage failure should never prevent startup.
  }
}

export function saveSettings(
  state: SettingsState,
  storage: StorageLike | null = getBrowserStorage(),
) {
  if (!storage) return false
  try {
    const serialized = JSON.stringify(state)
    const previous = storage.getItem(SETTINGS_STORAGE_KEY)
    if (previous) storage.setItem(SETTINGS_BACKUP_KEY, previous)
    storage.setItem(SETTINGS_TEMP_KEY, serialized)
    storage.setItem(SETTINGS_STORAGE_KEY, serialized)
    storage.removeItem(SETTINGS_TEMP_KEY)
    return true
  } catch {
    return false
  }
}

export function normalizeWindowBounds(bounds: WindowBounds, workAreas: WorkArea[]): WindowBounds {
  const fallback = workAreas[0] ?? { x: 0, y: 0, width: 1440, height: 900 }
  const area =
    workAreas.find((candidate) => {
      const visibleWidth =
        Math.min(bounds.x + bounds.width, candidate.x + candidate.width) -
        Math.max(bounds.x, candidate.x)
      const visibleHeight =
        Math.min(bounds.y + bounds.height, candidate.y + candidate.height) -
        Math.max(bounds.y, candidate.y)
      return visibleWidth >= 48 && visibleHeight >= 48
    }) ?? fallback
  const width = Math.min(Math.max(640, bounds.width), area.width)
  const height = Math.min(Math.max(480, bounds.height), area.height)
  const x = Math.min(area.x + area.width - width, Math.max(area.x, bounds.x))
  const y = Math.min(area.y + area.height - height, Math.max(area.y, bounds.y))
  return { ...bounds, x, y, width, height }
}

function getBrowserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export const useSettingsStore = defineStore('settings', () => {
  const state = ref<SettingsState>(createDefaultSettings())
  const notice = ref<LoadResult['issue']>('none')
  let hydrated = false
  let saveTimer: ReturnType<typeof setTimeout> | undefined

  function hydrate() {
    if (hydrated) return
    const result = loadSettings()
    state.value = result.state
    notice.value = result.issue
    hydrated = true
  }

  function persist() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      saveSettings(state.value)
      saveTimer = undefined
    }, 500)
  }

  function flush() {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = undefined
    saveSettings(state.value)
  }

  function updateLayout(layout: Partial<SettingsState['settings']['layout']>) {
    state.value.settings.layout = { ...state.value.settings.layout, ...layout }
    persist()
  }

  function setTheme(theme: ThemePreference) {
    state.value.settings.theme = theme
    persist()
    applyTheme(theme)
  }

  function updateSession(session: Partial<SettingsState['session']>) {
    state.value.session = { ...state.value.session, ...session }
    persist()
  }

  function setRecent(paths: string[]) {
    state.value.recent = paths.filter(Boolean).slice(0, 50)
    persist()
  }

  function setFavorites(paths: string[]) {
    state.value.favorites = paths.filter(Boolean).slice(0, 50)
    persist()
  }

  return {
    state,
    notice,
    hydrate,
    persist,
    flush,
    updateLayout,
    setTheme,
    updateSession,
    setRecent,
    setFavorites,
  }
})

export function applyTheme(theme: ThemePreference) {
  if (typeof document === 'undefined') return
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}
