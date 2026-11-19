<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from 'vue'
import UiButton from './components/ui/UiButton.vue'
import UiDialog from './components/ui/UiDialog.vue'
import MarkdownEditor from './components/editor/MarkdownEditor.vue'
import {
  commandIsEnabled,
  commandMenus,
  commands,
  type CommandDefinition,
  type CommandId,
  type CommandMenu,
} from './services/commands'
import {
  applyTheme,
  normalizeWindowBounds,
  useSettingsStore,
  type LayoutMode,
  type ThemePreference,
} from './services/settings'
import { EditorRegistry } from './services/editor-registry'
import { createPreviewDocument } from './services/render-safety'
import { RenderScheduler, type RenderResult } from './services/markdown-renderer'
import { SourceMapService } from './services/source-map'
import { PreviewScroll } from './services/preview-scroll'
import { DocumentStatsScheduler, type DocumentStats } from './services/document-stats'
import { SaveCoordinator, type SaveStatus } from './services/save-coordinator'
import { createFileIpc, type OpenDocument, type TauriInvoke } from './types/ipc'
import {
  createConflictSession,
  diskVersionChanged,
  type ConflictSession,
} from './services/document-conflict'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'

type NavTab = 'files' | 'search' | 'outline'
type FileEntry = {
  id: string
  label: string
  path: string
  state?: 'ready' | 'missing' | 'loading' | 'error'
}
type DocumentTab = {
  id: string
  label: string
  modified: boolean
  token?: OpenDocument['token']
  displayPath?: string
  identity?: OpenDocument['identity']
  metadata?: OpenDocument['metadata']
  readOnly?: boolean
  diskVersion?: OpenDocument['diskVersion']
}

const desktopInvoke = (
  globalThis as typeof globalThis & {
    __TAURI_INTERNALS__?: { invoke: TauriInvoke }
  }
).__TAURI_INTERNALS__?.invoke
const fileIpc = desktopInvoke ? createFileIpc(desktopInvoke) : undefined

const shell = useTemplateRef('shell')
const central = useTemplateRef('central')
const settingsStore = useSettingsStore()
settingsStore.hydrate()
const persisted = settingsStore.state
const navWidth = ref(persisted.settings.layout.navWidth)
const viewportWidth = ref(1440)
const centralWidth = ref(0)
const previewRatio = ref(persisted.settings.layout.previewRatio)
const navVisible = ref(persisted.settings.layout.navVisible)
const layoutMode = ref<LayoutMode>(persisted.settings.layout.mode)
const narrowPane = ref<'preview' | 'source'>(persisted.settings.layout.narrowPane)
const scrollSync = ref(persisted.settings.layout.scrollSync)
const themePreference = ref<ThemePreference>(persisted.settings.theme)
const settingsOpen = ref(false)
const editorRegistry = new EditorRegistry()
const renderScheduler = new RenderScheduler()
const statsScheduler = new DocumentStatsScheduler()
const sourceMapService = new SourceMapService()
const previewScroll = new PreviewScroll(editorRegistry)
const previewShell = createPreviewDocument('')
const previewFrame = useTemplateRef('previewFrame')
const currentStats = ref<DocumentStats | undefined>()
const statsPending = ref(false)
const cursorPosition = ref({ line: 1, column: 1 })
const saveStates = ref<Record<string, SaveStatus>>({})
const saveErrors = ref<Record<string, string>>({})
const conflicts = ref<Record<string, ConflictSession | undefined>>({})
const saveCoordinator = new SaveCoordinator((documentId, status, error) => {
  saveStates.value = { ...saveStates.value, [documentId]: status }
  if (error) {
    saveErrors.value = {
      ...saveErrors.value,
      [documentId]: describeSaveError(error),
    }
  }
})
let previewResult: Pick<RenderResult, 'documentId' | 'revision' | 'html' | 'blocks'> | undefined
const stopEditorSubscription = editorRegistry.subscribe(({ id, dirty }) => {
  const tab = tabs.value.find((item) => item.id === id)
  if (tab) tab.modified = dirty
  renderScheduler.schedule({
    documentId: id,
    revision: editorRegistry.get(id)?.revision ?? 0,
    source: editorRegistry.getText(id),
  })
  scheduleStats(id)
  scheduleDocumentSave(id)
})
const activeNav = ref<NavTab>('files')
const activeTab = ref<string | null>(persisted.session.activeDocument)
const initialTabs = persisted.session.tabs.length ? persisted.session.tabs : ['readme', 'notes']
const tabs = ref<DocumentTab[]>(
  initialTabs.map((id) => ({
    id,
    label: id === 'readme' ? 'README.md' : id === 'notes' ? 'notes.md' : `未命名 ${id}`,
    modified: id.startsWith('untitled-') || id === 'notes',
  })),
)
const editorTexts: Record<string, string> = {
  readme: '# Markdown Studio\n\n在右侧编辑 Markdown 源码。\n',
  notes: '# Notes\n\n这是一个独立的文档草稿。\n',
}
for (const tab of tabs.value) {
  const text = editorTexts[tab.id] ?? ''
  editorRegistry.register(tab.id, text, tab.modified ? '' : text)
}
const stopCursorSubscription = editorRegistry.subscribeCursor((id) => {
  if (id === activeTab.value) cursorPosition.value = editorRegistry.cursorPosition(id)
})
const stopCompositionSubscription = editorRegistry.subscribeComposition((id, composing) => {
  saveCoordinator.setComposing(id, composing)
})
const stopStatsSubscription = statsScheduler.subscribe((event) => {
  if (
    event.documentId === activeTab.value &&
    event.revision === editorRegistry.get(event.documentId)?.revision
  ) {
    currentStats.value = event.stats
    statsPending.value = false
  }
})
const stopRenderSubscription = renderScheduler.subscribe((result) => {
  if (result.documentId !== activeTab.value) return
  previewResult = {
    documentId: result.documentId,
    revision: result.revision,
    blocks: result.blocks,
    html: renderScheduler.sanitize(result.html),
  }
  updatePreview()
})
const openMenu = ref<CommandMenu | null>(null)
const lastCommand = ref('')
const dragging = ref(false)
const navTabs: { id: NavTab; label: string }[] = [
  { id: 'files', label: '文件' },
  { id: 'search', label: '搜索' },
  { id: 'outline', label: '目录' },
]
const fileEntries: FileEntry[] = [
  { id: 'readme', label: 'README.md', path: 'docs/README.md' },
  { id: 'readme-example', label: 'README.md', path: 'examples/README.md' },
  { id: 'notes', label: 'notes.md', path: 'docs/notes.md' },
  { id: 'missing', label: 'archive.md', path: 'docs/archive.md', state: 'missing' },
]
const recentFiles = ref([...persisted.recent])
const favoriteFiles = ref([...persisted.favorites])
const duplicateNames = computed(
  () =>
    new Set(
      fileEntries
        .map((file) => file.label)
        .filter((label, _, all) => all.filter((item) => item === label).length > 1),
    ),
)
const hasDocument = computed(() => activeTab.value !== null)
const activeDocument = computed(() => tabs.value.find((tab) => tab.id === activeTab.value))
const saveStatus = computed(() => {
  const tab = activeDocument.value
  if (!tab) return ''
  if (tab.id.startsWith('untitled-') && !tab.token) return '未保存'
  if (tab.readOnly) return '只读'
  const status = saveStates.value[tab.id]
  if (status === 'waiting') return '等待保存'
  if (status === 'saving') return '正在保存…'
  if (status === 'error') return '保存失败'
  if (status === 'conflict') return '文件冲突'
  return tab.modified ? '待保存' : '已保存'
})

const isNarrow = computed(() => viewportWidth.value - navWidth.value < 640)
const navCollapsed = computed(() => !navVisible.value || isNarrow.value)
const effectiveMode = computed<LayoutMode>(() => {
  if (layoutMode.value === 'split') return isNarrow.value ? narrowPane.value : 'split'
  return layoutMode.value
})
const previewPixels = computed(() => Math.round((centralWidth.value * previewRatio.value) / 100))
const separatorMax = computed(() => Math.max(320, centralWidth.value - 320))
const shellStyle = computed(() => ({ '--nav-width': `${navWidth.value}px` }))
const centralStyle = computed(() => ({ '--preview-ratio': `${previewRatio.value}%` }))

applyTheme(themePreference.value)

function updateViewport() {
  viewportWidth.value = window.innerWidth
}

function scheduleActiveRender() {
  if (!activeTab.value) return
  renderScheduler.schedule({
    documentId: activeTab.value,
    revision: editorRegistry.get(activeTab.value)?.revision ?? 0,
    source: editorRegistry.getText(activeTab.value),
  })
}

function scheduleStats(id: string) {
  if (id !== activeTab.value) return
  currentStats.value = undefined
  statsPending.value = true
  statsScheduler.schedule({
    documentId: id,
    revision: editorRegistry.get(id)?.revision ?? 0,
    source: editorRegistry.getText(id),
  })
}

function scheduleDocumentSave(id: string) {
  if (!editorRegistry.isDirty(id) || conflicts.value[id]) return
  const request = buildSaveRequest(id)
  if (request) saveCoordinator.schedule(request)
}

function watchAuthorizedDocument(token: OpenDocument['token']) {
  void fileIpc?.watchDocument(token).catch(() => {
    lastCommand.value = '文件变更监听不可用；切回应用时仍会复核磁盘版本'
  })
}

function describeSaveError(error: unknown) {
  const payload = error as { code?: string; message?: string }
  if (payload?.code === 'CONFLICT_DURING_COMMIT') {
    const operationId = (error as { operationId?: string })?.operationId
    return `提交期间发现磁盘竞态，恢复副本已保留${operationId ? `（${operationId}）` : ''}；自动保存已暂停`
  }
  if (payload?.code === 'CONFLICT') return '磁盘文件已变化，已暂停自动保存；请另存为以保留当前编辑'
  if (payload?.code === 'READ_ONLY') return '文件为只读状态，当前编辑仍保留在内存中'
  if (payload?.code === 'DISK_FULL') return '磁盘空间不足，当前编辑仍保留在内存中'
  if (payload?.code === 'FILE_BUSY') return '文件正被其他程序占用，可重试或另存为'
  return payload?.message ?? '保存失败，当前编辑仍保留在内存中'
}

async function beginConflict(
  id: string,
  reason: 'modified' | 'missing' | 'replaced' | 'unavailable' = 'modified',
  message?: string,
) {
  const tab = tabs.value.find((item) => item.id === id)
  if (!tab?.token) return
  saveCoordinator.pause(id)
  const base = editorRegistry.getSavedText(id)
  let disk: OpenDocument | null = null
  if (fileIpc) {
    try {
      disk = await fileIpc.readLatestDocument(tab.token)
      reason =
        disk.identity.volume === tab.identity?.volume && disk.identity.index === tab.identity?.index
          ? reason
          : 'replaced'
    } catch (error) {
      reason = (error as { code?: string })?.code === 'NOT_FOUND' ? 'missing' : 'unavailable'
    }
  }
  conflicts.value = {
    ...conflicts.value,
    [id]: createConflictSession(id, base, editorRegistry.getText(id), disk, reason),
  }
  showSourcePane()
  saveStates.value = { ...saveStates.value, [id]: 'conflict' }
  saveErrors.value = { ...saveErrors.value, [id]: message ?? describeConflict(reason) }
}

function describeConflict(reason: ConflictSession['reason']) {
  if (reason === 'missing') return '原文件已删除或移动，自动保存已暂停；不会自动重建原文件'
  if (reason === 'unavailable') return '无法读取原文件，自动保存已暂停；请另存为保留当前编辑'
  if (reason === 'replaced') return '原文件已被替换，自动保存已暂停；请查看差异或明确覆盖'
  return '文件已在外部更新，自动保存已暂停；请查看差异或明确处理'
}

async function reloadConflict(id: string) {
  const conflict = conflicts.value[id]
  const tab = tabs.value.find((item) => item.id === id)
  if (!conflict?.disk || !tab) return
  if (conflict.local !== editorRegistry.getSavedText(id)) {
    const confirmed = window.confirm('重新加载会丢弃当前本地编辑。是否继续？')
    if (!confirmed) return
  }
  const revision = editorRegistry.get(id)?.revision
  try {
    const adopted = fileIpc
      ? await fileIpc.adoptDocumentVersion(tab.token!, conflict.disk.diskVersion)
      : conflict.disk
    if (revision !== editorRegistry.get(id)?.revision) {
      await beginConflict(id)
      return
    }
    editorRegistry.reload(id, adopted.text)
    tab.metadata = adopted.metadata
    tab.diskVersion = adopted.diskVersion
    tab.identity = adopted.identity
    tab.readOnly = adopted.readOnly
    conflicts.value = { ...conflicts.value, [id]: undefined }
    delete saveErrors.value[id]
    saveCoordinator.resume(id)
    saveStates.value = { ...saveStates.value, [id]: 'saved' }
    lastCommand.value = '已重新加载磁盘版本'
  } catch {
    await beginConflict(id)
  }
}

function keepConflictEdits(id: string) {
  if (!conflicts.value[id]) return
  saveStates.value = { ...saveStates.value, [id]: 'conflict' }
  saveErrors.value = {
    ...saveErrors.value,
    [id]: '已保留当前编辑，自动保存仍暂停；请另存为或明确覆盖',
  }
}

async function overwriteConflict(id: string) {
  const conflict = conflicts.value[id]
  const tab = tabs.value.find((item) => item.id === id)
  if (!conflict?.disk || !tab?.token || !fileIpc) return
  try {
    const revision = editorRegistry.get(id)?.revision
    const adopted = await fileIpc.adoptDocumentVersion(tab.token, conflict.disk.diskVersion)
    tab.identity = adopted.identity
    tab.diskVersion = adopted.diskVersion
    tab.metadata = adopted.metadata
    tab.readOnly = adopted.readOnly
    conflicts.value = { ...conflicts.value, [id]: undefined }
    delete saveErrors.value[id]
    saveCoordinator.resume(id)
    if (revision !== editorRegistry.get(id)?.revision) {
      await beginConflict(id)
      return
    }
    await saveDocument(id, true)
    lastCommand.value = '已确认覆盖最新磁盘版本'
  } catch (error) {
    await beginConflict(id, 'modified', describeSaveError(error))
    saveErrors.value = { ...saveErrors.value, [id]: describeSaveError(error) }
  }
}

async function saveDocument(id: string, manual = false) {
  const tab = tabs.value.find((item) => item.id === id)
  if (!tab) return
  const session = editorRegistry.get(id)
  if (!session || !editorRegistry.isDirty(id)) return
  if (conflicts.value[id]) {
    lastCommand.value = '文档存在冲突，请先重新加载、另存为或确认覆盖'
    return
  }
  if (!tab.token || !tab.metadata || !tab.diskVersion) {
    await saveDocumentAs(id)
    return
  }
  if (tab.readOnly) {
    lastCommand.value = '文件为只读状态，请使用另存为'
    return
  }
  const request = buildSaveRequest(id)
  if (!request) return
  if (manual) await saveCoordinator.saveNow(request)
  else saveCoordinator.schedule(request)
}

function buildSaveRequest(id: string) {
  const tab = tabs.value.find((item) => item.id === id)
  const session = editorRegistry.get(id)
  if (!tab?.token || !tab.metadata || !tab.diskVersion || !session) return undefined
  const revision = session.revision
  const text = editorRegistry.getText(id)
  return {
    documentId: id,
    revision,
    save: async () => {
      if (!fileIpc || !tab.token || !tab.metadata || !tab.diskVersion)
        throw new Error('桌面文件保存服务不可用')
      const result = await fileIpc.saveDocument(
        tab.token,
        text,
        tab.metadata,
        revision,
        tab.diskVersion,
      )
      tab.diskVersion = result.diskVersion
      tab.identity = result.identity
    },
    onSaved: () => {
      editorRegistry.markSaved(id, text)
      tab.modified = editorRegistry.isDirty(id)
      delete saveErrors.value[id]
    },
    onError: (error: unknown) => {
      saveErrors.value = { ...saveErrors.value, [id]: describeSaveError(error) }
      const code = (error as { code?: string })?.code
      if (code === 'CONFLICT' || code === 'CONFLICT_DURING_COMMIT' || code === 'NOT_FOUND')
        void beginConflict(
          id,
          code === 'NOT_FOUND' ? 'missing' : 'modified',
          describeSaveError(error),
        )
    },
  }
}

async function saveDocumentAs(id: string) {
  const tab = tabs.value.find((item) => item.id === id)
  const session = editorRegistry.get(id)
  if (!tab || !session || !fileIpc) {
    lastCommand.value = '另存为仅在桌面应用中可用'
    return
  }
  const text = editorRegistry.getText(id)
  try {
    const saved = await fileIpc.saveDocumentAs(
      text,
      tab.metadata ?? { bom: false, lineEndings: [], trailingNewline: false },
      session.revision,
    )
    if (!saved) return
    if (tab.token) void fileIpc.unwatchDocument(tab.token)
    tab.token = saved.token
    tab.label = saved.name
    tab.displayPath = saved.displayPath
    tab.identity = saved.identity
    tab.metadata = saved.metadata
    tab.diskVersion = saved.diskVersion
    tab.readOnly = saved.readOnly
    editorRegistry.markSaved(id, text)
    tab.modified = editorRegistry.isDirty(id)
    conflicts.value = { ...conflicts.value, [id]: undefined }
    saveCoordinator.resume(id)
    saveStates.value = { ...saveStates.value, [id]: 'saved' }
    watchAuthorizedDocument(saved.token)
    if (editorRegistry.isDirty(id)) scheduleDocumentSave(id)
    if (editorRegistry.isDirty(id)) scheduleDocumentSave(id)
  } catch (error) {
    saveErrors.value = { ...saveErrors.value, [id]: describeSaveError(error) }
    saveStates.value = { ...saveStates.value, [id]: 'error' }
  }
}

async function saveAllDocuments() {
  const dirtyTabs = tabs.value.filter((tab) => tab.modified && !tab.readOnly)
  await Promise.all(dirtyTabs.map((tab) => saveDocument(tab.id, true)))
}

function handlePreviewClick(event: MouseEvent) {
  if (event.button !== 0) return
  const target = event.target as Element | null
  if (!target || typeof target.closest !== 'function') return
  if (target.ownerDocument.getSelection()?.toString()) return
  const link = target.closest<HTMLAnchorElement>('a')
  if (link) {
    if (!link.getAttribute('href')?.startsWith('#')) event.preventDefault()
    return
  }
  if (target.closest('button, input, img, summary, video, audio, [contenteditable="true"]')) return
  const block = target.closest<HTMLElement>('[data-source-block]') ?? findNearestMappedBlock(target)
  if (!block) return
  const line = sourceMapService.getLine(block.dataset.sourceBlock ?? '')
  if (
    line === undefined ||
    !activeTab.value ||
    previewResult?.documentId !== activeTab.value ||
    previewResult.revision !== editorRegistry.get(activeTab.value)?.revision
  )
    return
  previewScroll.revealSource(line)
}

function findNearestMappedBlock(target: Element) {
  const targetTop = target.getBoundingClientRect().top
  const candidates = [
    ...(target.closest('article')?.querySelectorAll<HTMLElement>('[data-source-block]') ?? []),
  ]
  return candidates.reduce<HTMLElement | null>((nearest, candidate) => {
    if (!nearest) return candidate
    return Math.abs(candidate.getBoundingClientRect().top - targetTop) <
      Math.abs(nearest.getBoundingClientRect().top - targetTop)
      ? candidate
      : nearest
  }, null)
}

function bindPreviewInteractions() {
  const frameDocument = previewFrame.value?.contentDocument
  if (!frameDocument) return
  frameDocument.removeEventListener('click', handlePreviewClick)
  frameDocument.addEventListener('click', handlePreviewClick)
  previewScroll.attach(frameDocument)
  updatePreviewTheme()
  updatePreview()
}

function updatePreview() {
  const result = previewResult?.documentId === activeTab.value ? previewResult : undefined
  sourceMapService.setBlocks(result?.blocks ?? [])
  previewScroll.update(
    result?.documentId,
    result?.revision ?? -1,
    result?.html ?? '',
    result?.blocks ?? [],
  )
}

function updatePreviewTheme() {
  const root = previewFrame.value?.contentDocument?.documentElement
  if (!root) return
  if (themePreference.value === 'system') delete root.dataset.theme
  else root.dataset.theme = themePreference.value
}

function updateCentralSize() {
  centralWidth.value = central.value?.clientWidth ?? 0
}

function setNavWidth(event: PointerEvent) {
  if (!shell.value) return
  const bounds = shell.value.getBoundingClientRect()
  navWidth.value = Math.min(360, Math.max(180, event.clientX - bounds.left))
}

function startNavResize(event: PointerEvent) {
  if (isNarrow.value) return
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function stopResize() {
  dragging.value = false
}

function setPreviewRatio(event: PointerEvent) {
  const element = central.value
  if (!element) return
  const bounds = element.getBoundingClientRect()
  const minimum = Math.min(50, (320 / bounds.width) * 100)
  const maximum = Math.max(50, 100 - (320 / bounds.width) * 100)
  previewRatio.value = Math.min(
    maximum,
    Math.max(minimum, ((event.clientX - bounds.left) / bounds.width) * 100),
  )
}

function startSplitResize(event: PointerEvent) {
  if (effectiveMode.value !== 'split' || layoutMode.value !== 'split') return
  dragging.value = true
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

function onPointerMove(event: PointerEvent) {
  if (!dragging.value) return
  const target = event.target as HTMLElement | null
  if (target?.dataset.resize === 'nav') setNavWidth(event)
  if (target?.dataset.resize === 'split') setPreviewRatio(event)
}

function onKeyResize(event: KeyboardEvent) {
  if (!central.value || effectiveMode.value !== 'split' || layoutMode.value !== 'split') return
  const delta = event.key === 'ArrowLeft' ? -16 : event.key === 'ArrowRight' ? 16 : 0
  if (!delta) return
  const nextPixels = Math.min(separatorMax.value, Math.max(320, previewPixels.value + delta))
  previewRatio.value = centralWidth.value
    ? (nextPixels / centralWidth.value) * 100
    : previewRatio.value
  event.preventDefault()
}

function toggleNav() {
  navVisible.value = !navVisible.value
}

function chooseMode(mode: LayoutMode) {
  layoutMode.value = mode
  if (mode !== 'split') narrowPane.value = mode
}

function setThemePreference(theme: ThemePreference) {
  themePreference.value = theme
  settingsStore.setTheme(theme)
}

function cycleTheme() {
  const next: Record<ThemePreference, ThemePreference> = {
    system: 'light',
    light: 'dark',
    dark: 'system',
  }
  setThemePreference(next[themePreference.value])
}

function captureWindowState() {
  const current = persisted.session.window
  const bounds = normalizeWindowBounds(
    {
      x: Number.isFinite(window.screenX) ? window.screenX : current.x,
      y: Number.isFinite(window.screenY) ? window.screenY : current.y,
      width: window.outerWidth || window.innerWidth || current.width,
      height: window.outerHeight || window.innerHeight || current.height,
      maximized: current.maximized,
    },
    [
      {
        x: Number((window.screen as { availLeft?: number }).availLeft ?? 0),
        y: Number((window.screen as { availTop?: number }).availTop ?? 0),
        width: window.screen.availWidth,
        height: window.screen.availHeight,
      },
    ],
  )
  settingsStore.updateSession({ window: bounds })
}

function flushWindowState() {
  captureWindowState()
  settingsStore.flush()
}

function menuCommands(menu: CommandMenu) {
  return commands.filter((command) => command.menu === menu)
}

function commandEnabled(command: CommandDefinition) {
  return commandIsEnabled(command, hasDocument.value)
}

function showSourcePane() {
  if (layoutMode.value === 'preview') layoutMode.value = 'source'
  narrowPane.value = 'source'
}

function dispatchCommand(id: CommandId) {
  const command = commands.find((item) => item.id === id)
  if (!command || !commandEnabled(command)) return
  openMenu.value = null
  lastCommand.value = command.label
  switch (id) {
    case 'file.open':
      void chooseAndOpenDocuments()
      break
    case 'file.save':
      if (activeTab.value) void saveDocument(activeTab.value, true)
      break
    case 'file.saveAll':
      void saveAllDocuments()
      break
    case 'file.saveAs':
      if (activeTab.value) void saveDocumentAs(activeTab.value)
      break
    case 'view.navigation':
      toggleNav()
      break
    case 'view.split':
      chooseMode('split')
      break
    case 'view.preview':
      chooseMode('preview')
      break
    case 'view.source':
      chooseMode('source')
      break
    case 'view.outline':
      activeNav.value = 'outline'
      break
    case 'view.scrollSync':
      scrollSync.value = !scrollSync.value
      lastCommand.value = scrollSync.value ? '开启滚动同步' : '关闭滚动同步'
      break
    case 'view.theme':
      cycleTheme()
      break
    case 'tools.settings':
      settingsOpen.value = true
      break
    case 'edit.undo':
      editorRegistry.undo()
      break
    case 'edit.redo':
      editorRegistry.redo()
      break
    case 'edit.find':
    case 'edit.replace':
      showSourcePane()
      void nextTick(() => editorRegistry.showSearch(id === 'edit.replace'))
      break
    case 'format.heading':
    case 'format.bold':
    case 'format.italic':
    case 'format.strikethrough':
    case 'format.list':
    case 'format.quote':
    case 'format.code':
    case 'format.link':
    case 'format.image':
    case 'format.table':
      showSourcePane()
      void nextTick(() => editorRegistry.format(id))
      break
    case 'file.new': {
      const id = `untitled-${tabs.value.length + 1}`
      tabs.value.push({ id, label: `未命名 ${tabs.value.length + 1}`, modified: true })
      editorRegistry.register(id, '')
      activeTab.value = id
      break
    }
    case 'file.close': {
      const position = tabs.value.findIndex((tab) => tab.id === activeTab.value)
      if (position < 0) break
      const closing = tabs.value[position]
      if (closing?.token) void fileIpc?.unwatchDocument(closing.token)
      tabs.value.splice(position, 1)
      activeTab.value = tabs.value[position]?.id ?? tabs.value[position - 1]?.id ?? null
      if (activeTab.value && !editorRegistry.has(activeTab.value)) {
        editorRegistry.register(activeTab.value, editorTexts[activeTab.value] ?? '')
      }
      break
    }
    default:
      break
  }
}

watch(
  [navWidth, previewRatio, navVisible, layoutMode, narrowPane, scrollSync],
  () =>
    settingsStore.updateLayout({
      navWidth: navWidth.value,
      previewRatio: previewRatio.value,
      navVisible: navVisible.value,
      mode: layoutMode.value,
      narrowPane: narrowPane.value,
      scrollSync: scrollSync.value,
    }),
  { flush: 'post' },
)
watch(
  [activeTab, tabs],
  () =>
    settingsStore.updateSession({
      activeDocument: activeTab.value,
      tabs: tabs.value.map((tab) => tab.id),
    }),
  { deep: true, flush: 'post' },
)
watch(
  activeTab,
  (id) => {
    previewResult = undefined
    if (!id) previewScroll.detach()
    updatePreview()
    previewScroll.attachSource()
    currentStats.value = undefined
    statsPending.value = false
    cursorPosition.value = id ? editorRegistry.cursorPosition(id) : { line: 1, column: 1 }
    if (id) scheduleStats(id)
    else statsScheduler.cancel()
    scheduleActiveRender()
  },
  { flush: 'post' },
)
watch(themePreference, updatePreviewTheme)
watch(
  [scrollSync, effectiveMode],
  () => previewScroll.configure(scrollSync.value, effectiveMode.value === 'split'),
  { immediate: true },
)
watch(recentFiles, () => settingsStore.setRecent(recentFiles.value), { deep: true, flush: 'post' })
watch(favoriteFiles, () => settingsStore.setFavorites(favoriteFiles.value), {
  deep: true,
  flush: 'post',
})

function closeTab(tabId: string) {
  if (activeTab.value !== tabId) activeTab.value = tabId
  dispatchCommand('file.close')
}

async function chooseAndOpenDocuments() {
  if (!fileIpc) {
    lastCommand.value = '原生文件对话框仅在桌面应用中可用'
    return
  }
  try {
    const documents = await fileIpc.chooseAndOpenDocuments()
    for (const document of documents) openAuthorizedDocument(document)
    if (documents.length) lastCommand.value = `已打开 ${documents.length} 个文件`
  } catch (error) {
    lastCommand.value = describeOpenError(error)
  }
}

function openAuthorizedDocument(document: OpenDocument) {
  const existing = tabs.value.find(
    (tab) =>
      (tab.identity?.volume === document.identity.volume &&
        tab.identity.index === document.identity.index) ||
      tab.displayPath?.toLocaleLowerCase() === document.displayPath.toLocaleLowerCase(),
  )
  if (existing) {
    const hadConflict = editorRegistry.isDirty(existing.id)
    const changedOnDisk =
      existing.diskVersion && diskVersionChanged(existing.diskVersion, document.diskVersion)
    const identityReplaced =
      existing.identity?.volume !== document.identity.volume ||
      existing.identity.index !== document.identity.index
    if (existing.token && existing.token !== document.token)
      void fileIpc?.unwatchDocument(existing.token)
    existing.token = document.token
    existing.displayPath = document.displayPath
    if (hadConflict) {
      if (changedOnDisk) void beginConflict(existing.id, identityReplaced ? 'replaced' : 'modified')
    } else {
      editorRegistry.reload(existing.id, document.text)
      existing.metadata = document.metadata
      existing.readOnly = document.readOnly
      existing.diskVersion = document.diskVersion
      existing.identity = document.identity
      existing.modified = false
      saveCoordinator.resume(existing.id)
      saveStates.value = { ...saveStates.value, [existing.id]: 'saved' }
    }
    watchAuthorizedDocument(document.token)
    activeTab.value = existing.id
    watchAuthorizedDocument(document.token)
    return
  }
  const id = `file-${document.identity.volume}-${document.identity.index}`
  tabs.value.push({
    id,
    label: document.name,
    modified: false,
    token: document.token,
    displayPath: document.displayPath,
    identity: document.identity,
    metadata: document.metadata,
    readOnly: document.readOnly,
    diskVersion: document.diskVersion,
  })
  editorRegistry.register(id, document.text, document.text, document.readOnly)
  activeTab.value = id
  watchAuthorizedDocument(document.token)
  if (!recentFiles.value.includes(document.displayPath)) {
    recentFiles.value.unshift(document.displayPath)
    recentFiles.value = recentFiles.value.slice(0, 50)
  }
}

function describeOpenError(error: unknown) {
  const payload = error as { code?: string; message?: string }
  if (payload?.code === 'UNSUPPORTED_ENCODING') {
    return '文件不是有效 UTF-8，已拒绝打开为可编辑文档'
  }
  if (payload?.code === 'PERMISSION_DENIED') return '没有权限读取此文件'
  if (payload?.code === 'NOT_FOUND') return '文件已不存在或被移动'
  return payload?.message ?? '打开文件失败'
}

function openFile(file: FileEntry) {
  if (file.state === 'missing') {
    lastCommand.value = '文件不存在，可重新定位或移除记录'
    return
  }
  const existing = tabs.value.find((tab) => tab.id === file.id)
  if (!existing) tabs.value.push({ id: file.id, label: file.label, modified: false })
  if (!editorRegistry.has(file.id)) {
    const text = editorTexts[file.id] ?? ''
    editorRegistry.register(file.id, text)
  }
  activeTab.value = file.id
  if (!recentFiles.value.includes(file.path)) recentFiles.value.unshift(file.path)
}

function onNavTabKeydown(event: KeyboardEvent, tabIndex: number) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? navTabs.length - 1
        : (tabIndex + (event.key === 'ArrowRight' ? 1 : -1) + navTabs.length) % navTabs.length
  activeNav.value = navTabs[next]!.id
  nextTick(() =>
    document.querySelector<HTMLElement>(`[data-nav-tab="${activeNav.value}"]`)?.focus(),
  )
  event.preventDefault()
}

function shortcutForEvent(event: KeyboardEvent) {
  const modifier = event.ctrlKey || event.metaKey
  if (event.key === 'F8') return 'F8'
  if (event.key === 'F11') return 'F11'
  if (!modifier) return ''
  const key = event.key.toUpperCase()
  if (event.altKey && key === 'O') return 'Ctrl+Alt+O'
  if (event.shiftKey) return `Ctrl+Shift+${key}`
  return `Ctrl+${key}`
}

function onGlobalKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.defaultPrevented) return
  const shortcut = shortcutForEvent(event)
  const command = commands.find((item) => item.shortcut === shortcut)
  if (!command) return
  if (command.id === 'edit.undo' || command.id === 'edit.redo') {
    const target = event.target as Element | null
    if (target?.closest('input, textarea')) return
  }
  event.preventDefault()
  dispatchCommand(command.id)
}

let resizeObserver: ResizeObserver | undefined
let stopDocumentChanged: UnlistenFn | undefined
function handleDocumentChanged(token: string) {
  const tab = tabs.value.find((item) => item.token === token)
  if (!tab?.token) return
  if (saveCoordinator.status(tab.id) === 'saving') {
    window.setTimeout(() => handleDocumentChanged(token), 250)
    return
  }
  void fileIpc!
    .readLatestDocument(tab.token)
    .then(async (document) => {
      if (!tab.diskVersion || !diskVersionChanged(tab.diskVersion, document.diskVersion)) return
      const revision = editorRegistry.get(tab.id)?.revision
      if (
        !editorRegistry.isDirty(tab.id) &&
        !['waiting', 'saving', 'conflict'].includes(saveCoordinator.status(tab.id))
      ) {
        const adopted = await fileIpc!.adoptDocumentVersion(tab.token!, document.diskVersion)
        if (
          revision !== editorRegistry.get(tab.id)?.revision ||
          editorRegistry.isDirty(tab.id) ||
          ['waiting', 'saving', 'conflict'].includes(saveCoordinator.status(tab.id))
        ) {
          await beginConflict(tab.id)
          return
        }
        editorRegistry.reload(tab.id, adopted.text)
        tab.metadata = adopted.metadata
        tab.diskVersion = adopted.diskVersion
        tab.identity = adopted.identity
        tab.readOnly = adopted.readOnly
        lastCommand.value = '文件已在外部更新，已安全重新加载'
      } else {
        await beginConflict(tab.id)
      }
    })
    .catch(
      (error) =>
        void beginConflict(
          tab.id,
          (error as { code?: string })?.code === 'NOT_FOUND' ? 'missing' : 'unavailable',
        ),
    )
}

async function verifyOpenDocuments() {
  if (!fileIpc) return
  await Promise.all(
    tabs.value
      .filter((tab) => tab.token)
      .map(async (tab) => {
        if (!tab.token || !tab.diskVersion) return
        if (saveCoordinator.status(tab.id) === 'saving') return
        try {
          const disk = await fileIpc.readLatestDocument(tab.token)
          if (!diskVersionChanged(tab.diskVersion, disk.diskVersion)) return
          const revision = editorRegistry.get(tab.id)?.revision
          if (
            !editorRegistry.isDirty(tab.id) &&
            !['waiting', 'saving', 'conflict'].includes(saveCoordinator.status(tab.id))
          ) {
            const adopted = await fileIpc.adoptDocumentVersion(tab.token, disk.diskVersion)
            if (
              revision !== editorRegistry.get(tab.id)?.revision ||
              editorRegistry.isDirty(tab.id) ||
              ['waiting', 'saving', 'conflict'].includes(saveCoordinator.status(tab.id))
            ) {
              await beginConflict(tab.id)
              return
            }
            editorRegistry.reload(tab.id, adopted.text)
            tab.metadata = adopted.metadata
            tab.diskVersion = adopted.diskVersion
            tab.identity = adopted.identity
            tab.readOnly = adopted.readOnly
            lastCommand.value = '文件已在外部更新，已安全重新加载'
          } else {
            await beginConflict(tab.id)
          }
        } catch (error) {
          await beginConflict(
            tab.id,
            (error as { code?: string })?.code === 'NOT_FOUND' ? 'missing' : 'unavailable',
          )
        }
      }),
  )
}
onMounted(() => {
  updateViewport()
  window.addEventListener('resize', updateViewport)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('pagehide', flushWindowState)
  window.addEventListener('beforeunload', flushWindowState)
  window.addEventListener('focus', verifyOpenDocuments)
  resizeObserver = new ResizeObserver(updateCentralSize)
  if (central.value) resizeObserver.observe(central.value)
  updateCentralSize()
  scheduleActiveRender()
  if (activeTab.value) scheduleStats(activeTab.value)
  if (fileIpc) {
    void listen<string>('document-changed', (event) => handleDocumentChanged(event.payload)).then(
      (unlisten) => {
        stopDocumentChanged = unlisten
      },
    )
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport)
  window.removeEventListener('focus', verifyOpenDocuments)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pagehide', flushWindowState)
  window.removeEventListener('beforeunload', flushWindowState)
  flushWindowState()
  settingsStore.flush()
  stopEditorSubscription()
  stopCursorSubscription()
  stopStatsSubscription()
  stopRenderSubscription()
  stopCompositionSubscription()
  renderScheduler.dispose()
  statsScheduler.dispose()
  saveCoordinator.dispose()
  previewScroll.dispose()
  editorRegistry.destroy()
  resizeObserver?.disconnect()
  stopDocumentChanged?.()
})
</script>

<template>
  <main
    ref="shell"
    class="app-shell"
    :class="{ 'nav-collapsed': navCollapsed, 'is-dragging': dragging, 'is-narrow': isNarrow }"
    :style="shellStyle"
    aria-labelledby="app-title"
  >
    <header class="app-toolbar">
      <h1 id="app-title" class="app-brand">Markdown Studio</h1>
      <nav class="command-bar" aria-label="应用菜单">
        <div v-for="menu in commandMenus" :key="menu.id" class="command-menu">
          <button
            type="button"
            :aria-expanded="openMenu === menu.id"
            aria-haspopup="menu"
            @click="openMenu = openMenu === menu.id ? null : menu.id"
          >
            {{ menu.label }}
          </button>
          <div
            v-if="openMenu === menu.id"
            class="command-menu-panel"
            role="menu"
            :aria-label="menu.label"
          >
            <button
              v-for="command in menuCommands(menu.id)"
              :key="command.id"
              type="button"
              :role="command.id === 'view.scrollSync' ? 'menuitemcheckbox' : 'menuitem'"
              :aria-checked="command.id === 'view.scrollSync' ? scrollSync : undefined"
              :disabled="!commandEnabled(command)"
              @click="dispatchCommand(command.id)"
            >
              <span>{{ command.label }}</span><span
                v-if="command.id === 'view.scrollSync' && scrollSync"
                aria-hidden="true"
                >✓</span
              ><kbd v-if="command.shortcut">{{ command.shortcut }}</kbd>
            </button>
          </div>
        </div>
      </nav>
      <div class="toolbar-actions">
        <UiButton aria-label="切换导航栏" @click="dispatchCommand('view.navigation')">{{
          navCollapsed ? '显示导航' : '隐藏导航'
        }}</UiButton>
        <UiButton
          :disabled="
            !commandEnabled(commands.find((command) => command.id === 'file.save')!) ||
            activeDocument?.readOnly
          "
          @click="dispatchCommand('file.save')"
          >保存</UiButton
        >
        <UiButton
          :disabled="!commandEnabled(commands.find((command) => command.id === 'file.export')!)"
          @click="dispatchCommand('file.export')"
          >导出</UiButton
        >
        <div class="layout-switcher" role="group" aria-label="文档布局">
          <button
            type="button"
            :aria-pressed="layoutMode === 'split'"
            @click="dispatchCommand('view.split')"
          >
            双栏
          </button>
          <button
            type="button"
            :aria-pressed="layoutMode === 'preview'"
            @click="dispatchCommand('view.preview')"
          >
            预览
          </button>
          <button
            type="button"
            :aria-pressed="layoutMode === 'source'"
            @click="dispatchCommand('view.source')"
          >
            源码
          </button>
        </div>
        <UiButton aria-label="当前主题" @click="dispatchCommand('view.theme')">主题</UiButton>
        <UiButton aria-label="打开设置" @click="dispatchCommand('tools.settings')">设置</UiButton>
      </div>
    </header>

    <aside class="app-nav" aria-label="工作区导航">
      <div class="workspace-heading">
        <strong>本地 Markdown 工作台</strong
        ><button type="button" aria-label="更多工作区操作">…</button>
      </div>
      <div class="nav-tabs" role="tablist" aria-label="导航页签">
        <button
          v-for="(tab, tabIndex) in navTabs"
          :key="tab.id"
          :data-nav-tab="tab.id"
          type="button"
          role="tab"
          :tabindex="activeNav === tab.id ? 0 : -1"
          :aria-selected="activeNav === tab.id"
          :class="{ selected: activeNav === tab.id }"
          @click="activeNav = tab.id as NavTab"
          @keydown="onNavTabKeydown($event, tabIndex)"
        >
          {{ tab.label }}
        </button>
      </div>
      <section class="nav-content" :aria-label="`${activeNav}内容`">
        <template v-if="activeNav === 'files'">
          <div class="nav-section-title">文件</div>
          <button
            v-for="file in fileEntries"
            :key="file.id"
            class="file-entry"
            :class="{ selected: activeTab === file.id, missing: file.state === 'missing' }"
            type="button"
            :aria-label="`${file.label} ${file.path}`"
            @click="openFile(file)"
          >
            <span>{{ file.label }}</span><small v-if="duplicateNames.has(file.label)">{{
              file.path
            }}</small>
            <em v-if="file.state === 'missing'">文件不存在</em>
          </button>
          <div class="nav-section-title secondary">最近打开</div>
          <button
            v-for="path in recentFiles"
            :key="path"
            class="nav-record"
            type="button"
            @click="lastCommand = `最近打开：${path}`"
          >
            {{ path }}
          </button>
          <div class="nav-section-title secondary">收藏</div>
          <button
            v-for="path in favoriteFiles"
            :key="path"
            class="nav-record"
            type="button"
            @click="lastCommand = `收藏：${path}`"
          >
            {{ path }}
          </button>
        </template>
        <template v-else-if="activeNav === 'search'">
          <label class="nav-search"
            >搜索文件或内容<input type="search" placeholder="输入关键词"
          /></label>
          <p class="nav-empty">暂无搜索结果</p>
        </template>
        <template v-else>
          <p v-if="!activeTab" class="nav-empty">打开文档后显示目录</p>
          <button
            v-else
            class="outline-entry"
            type="button"
            @click="lastCommand = '已定位到 Markdown Studio'"
          >
            Markdown Studio
          </button>
        </template>
      </section>
      <div
        class="nav-resizer"
        data-resize="nav"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="navWidth"
        aria-valuemin="180"
        aria-valuemax="360"
        tabindex="0"
        aria-label="调整导航栏宽度"
        @pointerdown="startNavResize"
        @keydown.left.prevent="navWidth = Math.max(180, navWidth - 16)"
        @keydown.right.prevent="navWidth = Math.min(360, navWidth + 16)"
      />
    </aside>

    <div class="document-tabs" role="tablist" aria-label="打开的文档">
      <div
        v-for="tab in tabs"
        :key="tab.id"
        class="document-tab"
        :class="{ selected: activeTab === tab.id }"
        role="tab"
        tabindex="0"
        :aria-selected="activeTab === tab.id"
        @click="activeTab = tab.id"
        @keydown.enter="activeTab = tab.id"
        @keydown.space.prevent="activeTab = tab.id"
      >
        <span v-if="tab.modified" aria-label="未保存">●</span>{{ tab.label
        }}<button
          class="tab-close"
          type="button"
          aria-label="关闭标签"
          @click.stop="closeTab(tab.id)"
        >
          ×
        </button>
      </div>
      <button class="new-tab" type="button" aria-label="新建标签">+</button>
    </div>

    <section
      ref="central"
      class="workbench"
      :class="`mode-${effectiveMode}`"
      :style="centralStyle"
      aria-label="文档工作区"
    >
      <div class="narrow-switcher" role="toolbar" aria-label="窄窗区域切换">
        <button
          type="button"
          :aria-pressed="effectiveMode === 'preview'"
          @click="narrowPane = 'preview'"
        >
          预览
        </button>
        <button
          type="button"
          :aria-pressed="effectiveMode === 'source'"
          @click="narrowPane = 'source'"
        >
          源码
        </button>
      </div>
      <section
        v-if="activeTab"
        class="document-pane preview-pane"
        aria-labelledby="preview-title"
        tabindex="0"
      >
        <header class="pane-header">
          <span id="preview-title">预览</span><span class="pane-hint">实时阅读</span>
        </header>
        <iframe
          ref="previewFrame"
          class="preview-frame"
          title="隔离的 Markdown 预览"
          sandbox="allow-same-origin"
          :srcdoc="previewShell"
          @load="bindPreviewInteractions"
        />
      </section>
      <div
        class="split-resizer"
        data-resize="split"
        role="separator"
        aria-orientation="vertical"
        :aria-valuenow="previewPixels"
        aria-valuemin="320"
        :aria-valuemax="separatorMax"
        tabindex="0"
        aria-label="调整预览和源码宽度"
        @pointerdown="startSplitResize"
        @keydown="onKeyResize"
      />
      <section v-if="activeTab" class="document-pane source-pane" aria-labelledby="source-title">
        <header class="pane-header">
          <span id="source-title">源码</span><span class="pane-hint">Markdown</span>
        </header>
        <section
          v-if="activeDocument && conflicts[activeDocument.id]"
          class="conflict-panel"
          aria-label="文件冲突对比"
          aria-live="polite"
        >
          <header class="conflict-heading">
            <strong>{{ describeConflict(conflicts[activeDocument.id]!.reason) }}</strong>
            <span>本地编辑不会自动覆盖磁盘版本。</span>
          </header>
          <div class="conflict-columns">
            <section>
              <h3>基线</h3>
              <pre>{{ conflicts[activeDocument.id]!.base }}</pre>
            </section>
            <section>
              <h3>当前编辑</h3>
              <pre>{{ conflicts[activeDocument.id]!.local }}</pre>
            </section>
            <section>
              <h3>磁盘版本</h3>
              <pre>{{ conflicts[activeDocument.id]!.disk?.text ?? '文件不可用' }}</pre>
            </section>
          </div>
          <div class="conflict-actions">
            <button
              v-if="conflicts[activeDocument.id]!.disk"
              type="button"
              @click="reloadConflict(activeDocument.id)"
            >
              重新加载磁盘版本
            </button>
            <button type="button" @click="keepConflictEdits(activeDocument.id)">
              保留当前编辑
            </button>
            <button type="button" @click="saveDocumentAs(activeDocument.id)">另存为</button>
            <button
              v-if="conflicts[activeDocument.id]!.disk"
              type="button"
              class="conflict-overwrite"
              @click="overwriteConflict(activeDocument.id)"
            >
              确认覆盖磁盘版本
            </button>
          </div>
        </section>
        <div v-if="activeDocument && saveErrors[activeDocument.id]" class="save-error" role="alert">
          <span>{{ saveErrors[activeDocument.id] }}</span>
          <button
            v-if="saveStates[activeDocument.id] !== 'conflict'"
            type="button"
            @click="saveDocument(activeDocument.id, true)"
          >
            重试
          </button>
          <button type="button" @click="saveDocumentAs(activeDocument.id)">另存为</button>
        </div>
        <MarkdownEditor
          :registry="editorRegistry"
          :document-id="activeTab"
          :line-wrapping="true"
          :font-size="14"
        />
      </section>
      <section v-if="!activeTab" class="empty-document" aria-label="欢迎页">
        <h2>开始使用 Markdown Studio</h2>
        <p>打开文件、新建文档，或从最近打开中继续。</p>
        <div class="empty-actions">
          <UiButton variant="primary" @click="dispatchCommand('file.new')">新建文档</UiButton
          ><UiButton @click="chooseAndOpenDocuments">打开文件</UiButton>
        </div>
      </section>
    </section>

    <footer class="status-bar" aria-label="文档状态">
      <span class="command-feedback" role="status" aria-label="命令反馈" aria-live="polite">{{
        lastCommand ? `已执行：${lastCommand}` : ''
      }}</span>
      <span class="status-document" role="status" aria-label="文档保存状态">{{
        activeDocument ? `${activeDocument.label} · ${saveStatus}` : '未打开文档'
      }}</span>
      <span v-if="activeDocument" class="status-cursor" title="行列从 1 开始，列按字素簇计数"
        >行 {{ cursorPosition.line }}，列 {{ cursorPosition.column }}</span
      >
      <span
        v-if="activeDocument"
        class="status-statistics"
        title="统计基于 Markdown 源码，字符数包含空白与换行"
      >
        <template v-if="currentStats"
          >{{ currentStats.words }} 字 · {{ currentStats.characters }} 字符</template
        >
        <template v-else>{{ statsPending ? '统计中…' : '统计不可用' }}</template>
      </span>
      <span class="status-mode">{{
        effectiveMode === 'preview'
          ? '仅预览模式'
          : effectiveMode === 'source'
            ? '仅源码模式'
            : '双栏模式'
      }}</span>
    </footer>

    <UiDialog v-model="settingsOpen" title="设置">
      <div class="settings-panel">
        <label class="settings-field"
          >主题
          <select
            aria-label="主题偏好"
            :value="themePreference"
            @change="
              setThemePreference(($event.target as HTMLSelectElement).value as ThemePreference)
            "
          >
            <option value="system">跟随系统</option>
            <option value="light">浅色</option>
            <option value="dark">深色</option>
          </select>
        </label>
        <label class="settings-field"
          >默认布局
          <select
            aria-label="默认布局"
            :value="layoutMode"
            @change="chooseMode(($event.target as HTMLSelectElement).value as LayoutMode)"
          >
            <option value="split">双栏</option>
            <option value="preview">仅预览</option>
            <option value="source">仅源码</option>
          </select>
        </label>
        <p v-if="settingsStore.notice === 'repaired'" class="settings-warning" role="status">
          配置文件无法读取，已恢复默认设置。
        </p>
      </div>
      <template #actions>
        <UiButton variant="primary" @click="settingsOpen = false">完成</UiButton>
      </template>
    </UiDialog>
  </main>
</template>
