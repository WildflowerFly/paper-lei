import MarkdownIt from 'markdown-it'
import { sanitizeRawHtml } from './render-safety'

export type SourceBlock = {
  blockId: string
  fromLine: number
  toLineExclusive: number
  kind: string
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

export function renderMarkdown(source: string): RawRenderResult {
  const tokens = markdown.parse(source, {})
  const blocks: SourceBlock[] = []
  let blockIndex = 0
  for (const token of tokens) {
    if (!token.map || token.hidden) continue
    if (
      ![
        'heading_open',
        'paragraph_open',
        'bullet_list_open',
        'ordered_list_open',
        'blockquote_open',
        'fence',
        'table_open',
      ].includes(token.type)
    )
      continue
    blocks.push({
      blockId: `block-${blockIndex++}`,
      fromLine: token.map[0],
      toLineExclusive: token.map[1],
      kind: token.type,
    })
  }
  return { html: markdown.render(source), blocks }
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
    return sanitizeRawHtml(html)
  }

  dispose() {
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
    this.listeners.clear()
    this.parser.dispose?.()
  }
}
