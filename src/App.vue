<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import UiButton from './components/ui/UiButton.vue'
import {
  commandIsEnabled,
  commandMenus,
  commands,
  type CommandDefinition,
  type CommandId,
  type CommandMenu,
} from './services/commands'

type LayoutMode = 'split' | 'preview' | 'source'
type NavTab = 'files' | 'search' | 'outline'
type FileEntry = {
  id: string
  label: string
  path: string
  state?: 'ready' | 'missing' | 'loading' | 'error'
}

const shell = useTemplateRef('shell')
const central = useTemplateRef('central')
const navWidth = ref(240)
const viewportWidth = ref(1440)
const centralWidth = ref(0)
const previewRatio = ref(50)
const navVisible = ref(true)
const layoutMode = ref<LayoutMode>('split')
const narrowPane = ref<'preview' | 'source'>('preview')
const activeNav = ref<NavTab>('files')
const activeTab = ref<string | null>('readme')
const tabs = ref([
  { id: 'readme', label: 'README.md', modified: false },
  { id: 'notes', label: 'notes.md', modified: true },
])
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
const recentFiles = ref(['docs/README.md', 'docs/notes.md'])
const favoriteFiles = ref(['docs/README.md'])
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

function updateViewport() {
  viewportWidth.value = window.innerWidth
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

function menuCommands(menu: CommandMenu) {
  return commands.filter((command) => command.menu === menu)
}

function commandEnabled(command: CommandDefinition) {
  return commandIsEnabled(command, hasDocument.value)
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
    case 'view.theme':
      document.documentElement.dataset.theme =
        document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
      break
    case 'file.new': {
      const id = `untitled-${tabs.value.length + 1}`
      tabs.value.push({ id, label: `未命名 ${tabs.value.length + 1}`, modified: true })
      activeTab.value = id
      break
    }
    case 'file.close': {
      const position = tabs.value.findIndex((tab) => tab.id === activeTab.value)
      if (position < 0) break
      tabs.value.splice(position, 1)
      activeTab.value = tabs.value[position]?.id ?? tabs.value[position - 1]?.id ?? null
      break
    }
    default:
      break
  }
}

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
  if (event.isComposing) return
  const shortcut = shortcutForEvent(event)
  const command = commands.find((item) => item.shortcut === shortcut)
  if (!command) return
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
  resizeObserver = new ResizeObserver(updateCentralSize)
  if (central.value) resizeObserver.observe(central.value)
  updateCentralSize()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopResize)
  window.removeEventListener('keydown', onGlobalKeydown)
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
              role="menuitem"
              :disabled="!commandEnabled(command)"
              @click="dispatchCommand(command.id)"
            >
              <span>{{ command.label }}</span><kbd v-if="command.shortcut">{{
                command.shortcut
              }}</kbd>
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
        <article class="markdown-body">
          <h2>Markdown Studio</h2>
          <p>在左侧管理文件，在这里阅读渲染结果。</p>
          <blockquote>预览和源码区域可以独立滚动。</blockquote>
          <h3>开始使用</h3>
          <ul>
            <li>打开或新建 Markdown 文档</li>
            <li>在右侧编辑源码</li>
          </ul>
        </article>
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
        <textarea aria-label="源码编辑器" spellcheck="false">
# Markdown Studio

在右侧编辑 Markdown 源码。</textarea>
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
  </main>
</template>
