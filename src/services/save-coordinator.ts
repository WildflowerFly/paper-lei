export type SaveStatus = 'idle' | 'waiting' | 'saving' | 'saved' | 'error' | 'conflict'

export type SaveRequest = {
  documentId: string
  revision: number
  save: () => Promise<void>
  onSaved: () => void
  onError?: (error: unknown) => void
}

type QueuedSave = SaveRequest & { resolve?: () => void }

type SaveEntry = {
  timer?: ReturnType<typeof setTimeout>
  composing: boolean
  paused: boolean
  scheduled?: SaveRequest
  queued?: QueuedSave
  running: boolean
}

export class SaveCoordinator {
  private readonly entries = new Map<string, SaveEntry>()
  private readonly statuses = new Map<string, SaveStatus>()

  constructor(
    private readonly onStatus: (documentId: string, status: SaveStatus, error?: unknown) => void,
    private readonly delay = 800,
  ) {}

  schedule(request: SaveRequest) {
    const entry = this.entry(request.documentId)
    if (entry.paused) return
    entry.scheduled = request
    this.setStatus(request.documentId, 'waiting')
    this.arm(request.documentId, entry)
  }

  setComposing(documentId: string, composing: boolean) {
    const entry = this.entry(documentId)
    entry.composing = composing
    if (composing) {
      this.clearTimer(entry)
      return
    }
    if (entry.scheduled && !entry.paused) this.arm(documentId, entry)
  }

  saveNow(request: SaveRequest) {
    const entry = this.entry(request.documentId)
    this.clearTimer(entry)
    entry.scheduled = request
    entry.paused = false
    return new Promise<void>((resolve) => {
      this.enqueue(request.documentId, { ...request, resolve })
    })
  }

  status(documentId: string) {
    return this.statuses.get(documentId) ?? 'idle'
  }

  dispose() {
    for (const entry of this.entries.values()) {
      this.clearTimer(entry)
      entry.queued?.resolve?.()
    }
    this.entries.clear()
    this.statuses.clear()
  }

  private entry(documentId: string) {
    let entry = this.entries.get(documentId)
    if (!entry) {
      entry = { composing: false, paused: false, running: false }
      this.entries.set(documentId, entry)
    }
    return entry
  }

  private arm(documentId: string, entry: SaveEntry) {
    this.clearTimer(entry)
    if (entry.composing || !entry.scheduled || entry.paused) return
    entry.timer = setTimeout(() => {
      entry.timer = undefined
      const request = entry.scheduled
      if (request && !entry.paused) this.enqueue(documentId, request)
    }, this.delay)
  }

  private enqueue(documentId: string, request: QueuedSave) {
    const entry = this.entry(documentId)
    entry.queued?.resolve?.()
    entry.queued = request
    if (!entry.running) void this.drain(documentId, entry)
  }

  private async drain(documentId: string, entry: SaveEntry) {
    entry.running = true
    while (entry.queued) {
      const request = entry.queued
      entry.queued = undefined
      this.setStatus(documentId, 'saving')
      try {
        await request.save()
        request.onSaved()
        if (entry.scheduled?.revision === request.revision) entry.scheduled = undefined
        this.setStatus(documentId, entry.queued || entry.scheduled ? 'waiting' : 'saved')
      } catch (error) {
        request.onError?.(error)
        entry.paused = true
        this.clearTimer(entry)
        this.resolveQueued(entry)
        const code = (error as { code?: string } | null)?.code
        this.setStatus(
          documentId,
          code === 'CONFLICT' || code === 'CONFLICT_DURING_COMMIT' ? 'conflict' : 'error',
          error,
        )
      } finally {
        request.resolve?.()
      }
    }
    entry.running = false
  }

  private clearTimer(entry: SaveEntry) {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = undefined
  }

  private resolveQueued(entry: SaveEntry) {
    const queued = entry.queued as QueuedSave | undefined
    entry.queued = undefined
    queued?.resolve?.()
  }

  private setStatus(documentId: string, status: SaveStatus, error?: unknown) {
    this.statuses.set(documentId, status)
    this.onStatus(documentId, status, error)
  }
}
