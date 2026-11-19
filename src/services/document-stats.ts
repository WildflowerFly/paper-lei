export type DocumentStats = {
  documentId: string
  revision: number
  words: number
  characters: number
}

export type StatsRequest = Pick<DocumentStats, 'documentId' | 'revision'> & {
  source: string
}

const wordSegmenter =
  typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'word' })
    : undefined

export function countMarkdownWords(source: string) {
  let words = 0
  for (const run of source.matchAll(/\p{Script=Han}|[^\p{Script=Han}\r\n]+/gu)) {
    const text = run[0]
    if (/^\p{Script=Han}$/u.test(text)) words++
    else {
      if (wordSegmenter) {
        for (const segment of wordSegmenter.segment(text)) if (segment.isWordLike) words++
      } else if (/\p{Letter}|\p{Number}/u.test(text)) words++
    }
  }
  return words
}

export function calculateDocumentStats(request: StatsRequest): DocumentStats {
  let characters = 0
  for (let index = 0; index < request.source.length; characters++) {
    index += request.source.codePointAt(index)! > 0xffff ? 2 : 1
  }
  return {
    documentId: request.documentId,
    revision: request.revision,
    words: countMarkdownWords(request.source),
    characters,
  }
}

type StatsWorkerRequest = { id: number; request: StatsRequest }
type StatsWorkerReply = { id: number; result?: DocumentStats; error?: string }

type StatsParser = ((request: StatsRequest) => Promise<DocumentStats>) & { dispose?: () => void }

export function createStatsParser(): StatsParser {
  if (typeof Worker === 'undefined')
    return Object.assign(async (request: StatsRequest) => calculateDocumentStats(request), {})
  const worker = new Worker(new URL('./stats.worker.ts', import.meta.url), { type: 'module' })
  const pending = new Map<
    number,
    { resolve: (result: DocumentStats) => void; reject: (error: Error) => void }
  >()
  let nextId = 0
  let failed = false
  worker.addEventListener('error', () => {
    failed = true
    for (const request of pending.values()) request.reject(new Error('无法启动统计 Worker'))
    pending.clear()
  })
  worker.addEventListener('message', (event: MessageEvent<StatsWorkerReply>) => {
    const request = pending.get(event.data.id)
    if (!request) return
    pending.delete(event.data.id)
    if (event.data.error) request.reject(new Error(event.data.error))
    else if (event.data.result) request.resolve(event.data.result)
    else request.reject(new Error('统计 Worker 返回空结果'))
  })
  return Object.assign(
    (request: StatsRequest) => {
      if (failed) return Promise.reject(new Error('统计 Worker 不可用'))
      const id = nextId++
      return new Promise<DocumentStats>((resolve, reject) => {
        pending.set(id, { resolve, reject })
        worker.postMessage({ id, request } satisfies StatsWorkerRequest)
      })
    },
    {
      dispose() {
        for (const request of pending.values()) request.reject(new Error('统计已取消'))
        pending.clear()
        worker.terminate()
      },
    },
  )
}

export class DocumentStatsScheduler {
  private readonly parser: StatsParser
  private readonly debounceMs: number
  private timer: ReturnType<typeof setTimeout> | undefined
  private sequence = 0
  private readonly listeners = new Set<
    (event: { documentId: string; revision: number; stats?: DocumentStats }) => void
  >()

  constructor(parser: StatsParser = createStatsParser(), debounceMs = 300) {
    this.parser = parser
    this.debounceMs = debounceMs
  }

  subscribe(
    listener: (event: { documentId: string; revision: number; stats?: DocumentStats }) => void,
  ) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  schedule(request: StatsRequest) {
    const sequence = ++this.sequence
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(async () => {
      this.timer = undefined
      const { documentId, revision } = request
      let stats: DocumentStats | undefined
      try {
        stats = await this.parser(request)
      } catch {
        stats = undefined
      }
      if (sequence !== this.sequence) return
      for (const listener of this.listeners) listener({ documentId, revision, stats })
    }, this.debounceMs)
  }

  cancel() {
    this.sequence++
    if (this.timer) clearTimeout(this.timer)
    this.timer = undefined
  }

  dispose() {
    this.cancel()
    this.listeners.clear()
    this.parser.dispose?.()
  }
}
