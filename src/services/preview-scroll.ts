import type { EditorRegistry } from './editor-registry'
import type { SourceBlock } from './markdown-renderer'
import {
  clampScroll,
  findBlockForSourceLine,
  findPreviewAnchor,
  interpolateBlockScroll,
  scrollForPreviewAnchor,
  ScrollSyncGuard,
  type ScrollAnchor,
  type ScrollBlock,
  type ScrollPane,
} from './scroll-sync'

type ReadingPosition = ScrollAnchor | 'top'

export class PreviewScroll {
  private document?: Document
  private article?: HTMLElement
  private documentId?: string
  private revision = -1
  private source?: HTMLElement
  private blocks = new Map<string, SourceBlock>()
  private geometry: ScrollBlock[] = []
  private readonly positions = new Map<string, ReadingPosition>()
  private readonly guard = new ScrollSyncGuard()
  private readonly observer = new ResizeObserver(() => this.invalidateGeometry())
  private frame = 0
  private geometryDirty = false
  private origin?: ScrollPane
  private intent?: ScrollPane
  private enabled = true
  private split = true
  private readonly unsubscribe: () => void

  constructor(private readonly editor: EditorRegistry) {
    this.unsubscribe = editor.subscribeScroll((id) => {
      if (id === this.documentId) this.onScroll('source')
    })
  }

  attach(document: Document) {
    if (this.document === document) return
    if (this.document) this.detach()
    const article = document.querySelector<HTMLElement>('article.markdown-body')
    if (!article) return
    this.document = document
    this.article = article
    document.addEventListener('scroll', this.onPreviewScroll, { passive: true })
    document.addEventListener('load', this.invalidateGeometry, true)
    document.addEventListener('error', this.invalidateGeometry, true)
    this.bindIntent(document, this.onPreviewIntent, true)
    this.observer.observe(article)
    this.observer.observe(document.documentElement)
    void document.fonts.ready.then(() => {
      if (this.document === document) this.invalidateGeometry()
    })
    this.attachSource()
  }

  attachSource() {
    const source = this.editor.scrollElement()
    if (this.source === source) return
    if (this.source) this.bindIntent(this.source, this.onSourceIntent, false)
    this.source = source
    if (source) this.bindIntent(source, this.onSourceIntent, true)
  }

  update(id: string | undefined, revision: number, html: string, blocks: SourceBlock[]) {
    if (!this.article) return
    this.documentId = id
    this.revision = revision
    this.origin = undefined
    this.intent = undefined
    this.guard.clear()
    this.blocks = new Map(
      blocks.filter((block) => block.scrollKey).map((block) => [block.blockId, block]),
    )
    this.geometry = []
    this.article.innerHTML = html
    this.invalidateGeometry()
  }

  configure(enabled: boolean, split: boolean) {
    this.enabled = enabled
    this.split = split
    this.origin = undefined
    this.guard.clear()
    this.invalidateGeometry()
  }

  revealSource(line: number) {
    if (this.origin === 'source') this.origin = undefined
    this.noteIntent('preview')
    this.editor.revealLine(line)
  }

  detach() {
    window.cancelAnimationFrame(this.frame)
    this.frame = 0
    this.origin = undefined
    this.intent = undefined
    this.guard.clear()
    this.observer.disconnect()
    if (this.source) this.bindIntent(this.source, this.onSourceIntent, false)
    this.source = undefined
    if (this.document) {
      this.document.removeEventListener('scroll', this.onPreviewScroll)
      this.document.removeEventListener('load', this.invalidateGeometry, true)
      this.document.removeEventListener('error', this.invalidateGeometry, true)
      this.bindIntent(this.document, this.onPreviewIntent, false)
    }
    this.document = undefined
    this.article = undefined
  }

  dispose() {
    this.detach()
    this.unsubscribe()
  }

  private bindIntent(target: EventTarget, listener: () => void, add: boolean) {
    for (const type of ['wheel', 'pointerdown', 'touchmove', 'keydown']) {
      if (add) target.addEventListener(type, listener, { passive: true, capture: true })
      else target.removeEventListener(type, listener, true)
    }
  }

  private readonly onPreviewIntent = () => this.noteIntent('preview')
  private readonly onSourceIntent = () => this.noteIntent('source')
  private readonly onPreviewScroll = () => this.onScroll('preview')

  private noteIntent(pane: ScrollPane) {
    this.guard.clear(pane)
    this.intent = pane
    if (this.origin !== pane) this.origin = undefined
    this.requestFrame()
  }

  private scroller(pane: ScrollPane) {
    return pane === 'preview' ? this.document?.scrollingElement : this.source
  }

  private onScroll(pane: ScrollPane) {
    const element = this.scroller(pane)
    if (!element?.clientHeight || this.guard.consume(pane, element.scrollTop)) return
    if (this.intent && this.intent !== pane) return
    if (pane === 'preview' && this.geometryDirty && this.intent !== 'preview') return
    this.origin = pane
    this.requestFrame()
  }

  private readonly invalidateGeometry = () => {
    this.geometryDirty = true
    this.requestFrame()
  }

  private requestFrame() {
    if (!this.frame) this.frame = window.requestAnimationFrame(this.flush)
  }

  private readonly flush = () => {
    this.frame = 0
    const preview = this.scroller('preview')
    if (preview?.clientHeight && this.article?.clientWidth) {
      if (this.geometryDirty) {
        this.geometryDirty = false
        this.measure(preview.scrollTop)
        const saved = this.documentId && this.positions.get(this.documentId)
        if (this.origin !== 'preview' && this.intent !== 'preview') {
          this.writeScroll(
            'preview',
            !saved || saved === 'top' ? 0 : scrollForPreviewAnchor(this.geometry, saved),
          )
        }
      }
      if (this.canSync() && this.origin === 'source') this.syncFromSource()
      if ((this.origin || this.geometry.length) && this.documentId) {
        const anchor =
          preview.scrollTop <= 1 ? 'top' : findPreviewAnchor(this.geometry, preview.scrollTop)
        if (anchor) this.positions.set(this.documentId, anchor)
      }
      if (this.canSync() && this.origin === 'preview') this.syncFromPreview(preview.scrollTop)
    }
    this.intent = undefined
    this.origin = undefined
  }

  private canSync() {
    return (
      this.enabled &&
      this.split &&
      this.geometry.length > 0 &&
      this.documentId &&
      this.editor.activeDocument() === this.documentId &&
      this.editor.get(this.documentId)?.revision === this.revision
    )
  }

  private measure(scrollTop: number) {
    const geometry: ScrollBlock[] = []
    for (const element of this.article?.querySelectorAll('[data-source-block]') ?? []) {
      const block = this.blocks.get(element.getAttribute('data-source-block') ?? '')
      if (!block?.scrollKey) continue
      const { top, bottom, height } = element.getBoundingClientRect()
      if (height <= 0) continue
      geometry.push({
        ...block,
        blockId: block.scrollKey,
        top: top + scrollTop,
        bottom: bottom + scrollTop,
      })
    }
    this.geometry = geometry
  }

  private syncFromSource() {
    const line = this.editor.sourceLineAtViewportTop()
    const source = this.scroller('source')
    if (line === undefined || !source) return
    const block = findBlockForSourceLine(this.geometry, line)
    if (!block) return
    this.writeScroll('preview', source.scrollTop <= 1 ? 0 : interpolateBlockScroll(block, line))
  }

  private syncFromPreview(scrollTop: number) {
    if (scrollTop <= 1) {
      this.writeScroll('source', 0)
      return
    }
    const anchor = findPreviewAnchor(this.geometry, scrollTop)
    const target = anchor && this.editor.scrollTopForSourceLine(anchor.sourceLine)
    if (typeof target === 'number') this.writeScroll('source', target)
  }

  private writeScroll(pane: ScrollPane, position: number) {
    const element = this.scroller(pane)
    if (!element?.clientHeight) return
    const top = clampScroll(position, element.scrollHeight - element.clientHeight)
    if (Math.abs(element.scrollTop - top) <= 1) return
    element.scrollTop = top
    this.guard.expect(pane, element.scrollTop)
  }
}
