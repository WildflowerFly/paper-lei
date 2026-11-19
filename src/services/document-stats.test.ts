import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  calculateDocumentStats,
  DocumentStatsScheduler,
  countMarkdownWords,
} from './document-stats'

describe('document statistics', () => {
  afterEach(() => vi.useRealTimers())

  it('counts Han characters individually, other word segments, and Unicode code points', () => {
    const result = calculateDocumentStats({
      documentId: 'doc',
      revision: 3,
      source: '中文 文档\nemoji 😀',
    })
    expect(result.words).toBe(5)
    expect(result.characters).toBe(13)
    expect(countMarkdownWords('汉word字 123，👩‍💻')).toBe(4)
    expect(countMarkdownWords('   !!!')).toBe(0)
  })

  it('drops stale asynchronous revisions', async () => {
    vi.useFakeTimers()
    const parser = vi.fn(async (request: Parameters<typeof calculateDocumentStats>[0]) => {
      await new Promise((resolve) => setTimeout(resolve, request.revision === 1 ? 30 : 1))
      return calculateDocumentStats(request)
    })
    const scheduler = new DocumentStatsScheduler(parser, 10)
    const results: number[] = []
    scheduler.subscribe((result) => results.push(result.revision))
    const request = (revision: number, source: string) => ({
      documentId: 'doc',
      revision,
      source,
    })
    scheduler.schedule(request(1, 'old'))
    await vi.advanceTimersByTimeAsync(10)
    scheduler.schedule(request(2, 'new'))
    await vi.advanceTimersByTimeAsync(50)
    expect(parser).toHaveBeenCalledTimes(2)
    expect(results).toEqual([2])
    scheduler.dispose()
  })
})
