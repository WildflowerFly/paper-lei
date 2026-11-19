import MarkdownIt, { type MarkdownIt as MarkdownItInstance, type Token } from 'markdown-it'
import footnote from 'markdown-it-footnote'
import taskLists from 'markdown-it-task-lists'
import { sanitizeRawHtml } from './render-safety'

export type SourceBlock = {
  blockId: string
  fromLine: number
  toLineExclusive: number
  kind: string
  scrollKey?: string
}

export type RawRenderResult = {
  html: string
  blocks: SourceBlock[]
}

export type RenderRequest = {
  documentId: string
  revision: number
  renderEpoch?: number
  source: string
}

export type RenderResult = RenderRequest & RawRenderResult & { renderEpoch: number }

const markdown = new MarkdownIt({
  html: true,
  linkify: true,
  breaks: false,
  typographer: false,
})
  .use(footnote as unknown as (md: MarkdownItInstance) => void)
  .use(taskLists as unknown as (md: MarkdownItInstance, options: { enabled: boolean }) => void, {
    enabled: false,
  })

function slugifyHeading(value: string, used: Set<string>) {
  const base =
    value
      .trim()
      .toLocaleLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{Letter}\p{Number}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-') || 'section'
  let slug = base
  let suffix = 2
  while (used.has(slug)) slug = `${base}-${suffix++}`
  used.add(slug)
  return slug
}

function addHeadingAnchors(tokens: Token[]) {
  const used = new Set<string>()
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const heading = tokens[index]
    const inline = tokens[index + 1]
    if (!heading || !inline || heading.type !== 'heading_open' || inline.type !== 'inline') continue
    const slug = slugifyHeading(inline.content, used)
    heading.attrSet('id', slug)
  }
}

function isMappedToken(token: Token) {
  return [
    'heading_open',
    'paragraph_open',
    'bullet_list_open',
    'ordered_list_open',
    'blockquote_open',
    'fence',
    'table_open',
  ].includes(token.type)
}

function hashBlock(source: string[], start: number, end: number) {
  let hash = 2166136261
  for (let line = start; line < end; line++) {
    for (const char of source[line] ?? '') hash = Math.imul(hash ^ char.codePointAt(0)!, 16777619)
    hash = Math.imul(hash ^ 10, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function collectBlocks(tokens: Token[], source: string) {
  const blocks: SourceBlock[] = []
  const lines = source.split(/\r\n?|\n/)
  const occurrences = new Map<string, number>()
  let blockIndex = 0
  for (const token of tokens) {
    if (!token.map || token.hidden || !isMappedToken(token)) continue
    const blockId = `block-${blockIndex++}`
    const target =
      token.type === 'heading_open' ||
      token.type === 'paragraph_open' ||
      token.type === 'bullet_list_open' ||
      token.type === 'ordered_list_open' ||
      token.type === 'blockquote_open' ||
      token.type === 'table_open'
        ? token
        : null
    if (target) target.attrSet('data-source-block', blockId)
    else if (token.type === 'fence') token.attrSet('data-source-block', blockId)
    const block: SourceBlock = {
      blockId,
      fromLine: token.map[0],
      toLineExclusive: token.map[1],
      kind: token.type,
    }
    if (token.level === 0) {
      const fingerprint = `${token.type}:${hashBlock(lines, block.fromLine, block.toLineExclusive)}`
      const occurrence = (occurrences.get(fingerprint) ?? 0) + 1
      occurrences.set(fingerprint, occurrence)
      block.scrollKey = `${fingerprint}:${occurrence}`
    }
    blocks.push(block)
  }
  return blocks
}

markdown.renderer.rules.heading_open = (tokens, index, options, _env, slf) => {
  const token = tokens[index]
  if (!token) return ''
  const id = token.attrGet('id')
  const opening = slf.renderToken(tokens, index, options)
  if (!id) return opening
  return `${opening}<a class="heading-anchor" href="#${id}" aria-label="链接到本节"></a>`
}

markdown.renderer.rules.table_close = () => '</table></div>'
markdown.renderer.rules.table_open = (tokens, index) => {
  const blockId = tokens[index]?.attrGet('data-source-block')
  return `<div class="table-scroll"${blockId ? ` data-source-block="${blockId}"` : ''}><table>`
}
const defaultFenceRenderer = markdown.renderer.rules.fence ?? (() => '')
markdown.renderer.rules.fence = (tokens, index, options, _env, slf) => {
  const token = tokens[index]
  if (!token) return ''
  const info = defaultFenceRenderer(tokens, index, options, _env, slf)
  if (!info) return ''
  const blockId = token.attrGet('data-source-block')
  return blockId ? info.replace('<pre>', `<pre data-source-block="${blockId}">`) : info
}

export function renderMarkdown(source: string): RawRenderResult {
  const tokens = markdown.parse(source, {})
  addHeadingAnchors(tokens)
  const blocks = collectBlocks(tokens, source)
  return { html: markdown.renderer.render(tokens, markdown.options, {}), blocks }
}

type WorkerMessage = { id: number; source: string }
type WorkerReply = { id: number; result?: RawRenderResult; error?: string }

type Parser = ((source: string) => Promise<RawRenderResult>) & { dispose?: () => void }

export function createMarkdownParser(): Parser {
  if (typeof Worker === 'undefined')
    return Object.assign(async (source: string) => renderMarkdown(source), {})
  const worker = new Worker(new URL('./markdown.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<
    number,
    { resolve: (result: RawRenderResult) => void; reject: (error: Error) => void }
  >()
  let nextId = 0
  worker.addEventListener('message', (event: MessageEvent<WorkerReply>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    if (event.data.error) request.reject(new Error(event.data.error))
    else if (event.data.result) request.resolve(event.data.result)
    else request.reject(new Error('渲染 Worker 返回空结果'))
  })
  const parser = Object.assign(
    (source: string) => {
      const id = nextId++
      return new Promise<RawRenderResult>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, source } satisfies WorkerMessage)
      })
    },
    {
      dispose() {
        for (const request of pending.values()) request.reject(new Error('渲染已取消'))
        pending.clear()
        worker.terminate()
      },
    },
  )
  return parser
}

export class RenderScheduler {
  private readonly parser: Parser
  private readonly debounceMs: number
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly latest = new Map<string, { revision: number; renderEpoch: number }>()
  private readonly listeners = new Set<(result: RenderResult) => void>()
  private renderEpoch = 0

  constructor(parser: Parser = createMarkdownParser(), debounceMs = 100) {
    this.parser = parser
    this.debounceMs = debounceMs
  }

  subscribe(listener: (result: RenderResult) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  schedule(request: RenderRequest) {
    const renderEpoch = request.renderEpoch ?? this.renderEpoch
    const next = { revision: request.revision, renderEpoch }
    this.latest.set(request.documentId, next)
    const timer = this.timers.get(request.documentId)
    if (timer) clearTimeout(timer)
    this.timers.set(
      request.documentId,
      setTimeout(async () => {
        this.timers.delete(request.documentId)
        try {
          const result = await this.parser(request.source)
          const current = this.latest.get(request.documentId)
          if (
            !current ||
            current.revision !== request.revision ||
            current.renderEpoch !== renderEpoch
          )
            return
          if (renderEpoch !== this.renderEpoch) return
          const resolved = { ...request, ...result, renderEpoch }
          for (const listener of this.listeners) listener(resolved)
        } catch {
          // A failed or cancelled render cannot replace the current preview.
        }
      }, this.debounceMs),
    )
  }

  invalidate() {
    this.renderEpoch += 1
    return this.renderEpoch
  }

  sanitize(html: string) {
    return sanitizeRawHtml(html, true)
  }

  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
    this.parser.dispose?.()
  }
}
