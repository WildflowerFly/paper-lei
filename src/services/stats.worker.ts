import { calculateDocumentStats, type StatsRequest } from './document-stats'

type StatsWorkerRequest = { id: number; request: StatsRequest }

self.addEventListener('message', (event: MessageEvent<StatsWorkerRequest>) => {
  try {
    self.postMessage({ id: event.data.id, result: calculateDocumentStats(event.data.request) })
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : '统计失败',
    })
  }
})
