<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, useTemplateRef } from 'vue'
import UiButton from './components/ui/UiButton.vue'

type LayoutMode = 'split' | 'preview' | 'source'
type NavTab = 'files' | 'search' | 'outline'

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
const activeTab = ref('readme')
const dragging = ref(false)

const tabs = [
  { id: 'readme', label: 'README.md', modified: false },
  { id: 'notes', label: 'notes.md', modified: true },
]

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

let resizeObserver: ResizeObserver | undefined
onMounted(() => {
  updateViewport()
  window.addEventListener('resize', updateViewport)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', stopResize)
  resizeObserver = new ResizeObserver(updateCentralSize)
  if (central.value) resizeObserver.observe(central.value)
  updateCentralSize()
})
onBeforeUnmount(() => {
  window.removeEventListener('resize', updateViewport)
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', stopResize)
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
        <button
          v-for="label in ['文件', '编辑', '视图', '格式', '工具', '帮助']"
          :key="label"
          type="button"
        >
          {{ label }}
        </button>
      </nav>
      <div class="toolbar-actions">
        <UiButton aria-label="切换导航栏" @click="toggleNav">{{
          navCollapsed ? '显示导航' : '隐藏导航'
        }}</UiButton>
        <div class="layout-switcher" role="group" aria-label="文档布局">
          <button type="button" :aria-pressed="layoutMode === 'split'" @click="chooseMode('split')">
            双栏
          </button>
          <button
            type="button"
            :aria-pressed="layoutMode === 'preview'"
            @click="chooseMode('preview')"
          >
            预览
          </button>
          <button
            type="button"
            :aria-pressed="layoutMode === 'source'"
            @click="chooseMode('source')"
          >
            源码
          </button>
        </div>
        <UiButton aria-label="当前主题">主题</UiButton>
      </div>
    </header>

    <aside class="app-nav" aria-label="工作区导航">
      <div class="workspace-heading">
        <strong>本地 Markdown 工作台</strong
        ><button type="button" aria-label="更多工作区操作">…</button>
      </div>
      <div class="nav-tabs" role="tablist" aria-label="导航页签">
        <button
          v-for="tab in [
            { id: 'files', label: '文件' },
            { id: 'search', label: '搜索' },
            { id: 'outline', label: '目录' },
          ]"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeNav === tab.id"
          :class="{ selected: activeNav === tab.id }"
          @click="activeNav = tab.id as NavTab"
        >
          {{ tab.label }}
        </button>
      </div>
      <section class="nav-content" :aria-label="`${activeNav}内容`">
        <template v-if="activeNav === 'files'">
          <div class="nav-section-title">文件</div>
          <button class="file-entry selected" type="button">README.md</button>
          <button class="file-entry" type="button">notes.md</button>
          <div class="nav-section-title secondary">最近打开</div>
          <p class="nav-empty">打开文件夹后显示文件</p>
        </template>
        <template v-else-if="activeNav === 'search'">
          <label class="nav-search"
            >搜索文件或内容<input type="search" placeholder="输入关键词"
          /></label>
          <p class="nav-empty">暂无搜索结果</p>
        </template>
        <p v-else class="nav-empty">当前文档暂无标题</p>
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
      <button
        v-for="tab in tabs"
        :key="tab.id"
        class="document-tab"
        :class="{ selected: activeTab === tab.id }"
        type="button"
        role="tab"
        :aria-selected="activeTab === tab.id"
        @click="activeTab = tab.id"
      >
        <span v-if="tab.modified" aria-label="未保存">●</span>{{ tab.label
        }}<span class="tab-close" aria-label="关闭标签">×</span>
      </button>
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
      <section class="document-pane preview-pane" aria-labelledby="preview-title" tabindex="0">
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
      <section class="document-pane source-pane" aria-labelledby="source-title">
        <header class="pane-header">
          <span id="source-title">源码</span><span class="pane-hint">Markdown</span>
        </header>
        <textarea aria-label="源码编辑器" spellcheck="false">
# Markdown Studio

在右侧编辑 Markdown 源码。</textarea>
      </section>
    </section>

    <footer class="status-bar" aria-label="文档状态">
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
