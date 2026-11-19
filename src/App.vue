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

type NavTab = 'files' | 'search' | 'outline'
type FileEntry = {
  id: string
  label: string
  path: string
  state?: 'ready' | 'missing' | 'loading' | 'error'
}

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
const sourceMapService = new SourceMapService()
const previewScroll = new PreviewScroll(editorRegistry)
const previewShell = createPreviewDocument('')
const previewFrame = useTemplateRef('previewFrame')
let previewResult: Pick<RenderResult, 'documentId' | 'revision' | 'html' | 'blocks'> | undefined
const stopEditorSubscription = editorRegistry.subscribe(({ id, dirty }) => {
  const tab = tabs.value.find((item) => item.id === id)
  if (tab) tab.modified = dirty
  renderScheduler.schedule({
    documentId: id,
    revision: editorRegistry.get(id)?.revision ?? 0,
    source: editorRegistry.getText(id),
  })
})
const activeNav = ref<NavTab>('files')
const activeTab = ref<string | null>(persisted.session.activeDocument)
const initialTabs = persisted.session.tabs.length ? persisted.session.tabs : ['readme', 'notes']
const tabs = ref(
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
onMounted(() => {
  updateViewport()
  window.addEventListener('resize', updateViewport)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopResize)
  window.addEventListener('keydown', onGlobalKeydown)
  window.addEventListener('pagehide', flushWindowState)
  window.addEventListener('beforeunload', flushWindowState)
  resizeObserver = new ResizeObserver(updateCentralSize)
  if (central.value) resizeObserver.observe(central.value)
  updateCentralSize()
  scheduleActiveRender()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('keydown', onGlobalKeydown)
  window.removeEventListener('pagehide', flushWindowState)
  window.removeEventListener('beforeunload', flushWindowState)
  flushWindowState()
  settingsStore.flush()
  stopEditorSubscription()
  stopRenderSubscription()
  renderScheduler.dispose()
  previewScroll.dispose()
  editorRegistry.destroy()
  resizeObserver?.disconnect()
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
          :disabled="!commandEnabled(commands.find((command) => command.id === 'file.save')!)"
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
          ><UiButton @click="activeNav = 'files'">打开文件</UiButton>
        </div>
      </section>
    </section>

    <footer class="status-bar" aria-label="文档状态">
      <span class="command-feedback" role="status" aria-live="polite">{{
        lastCommand ? `已执行：${lastCommand}` : ''
      }}</span>
      <span class="status-document"
        >{{ activeTab === 'readme' ? 'README.md' : 'notes.md' }} · 已保存</span
      ><span>34 字 · 52 字符</span><span>行 3，列 7</span
      ><span class="status-mode">{{
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
