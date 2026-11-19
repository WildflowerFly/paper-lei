import { renderMarkdown } from './markdown-renderer'

type WorkerRequest = { id: number; source: string }

self.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    self.postMessage({ id: event.data.id, result: renderMarkdown(event.data.source) })
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : '渲染失败',
    })
  }
})
