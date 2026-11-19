import { describe, expect, it, vi } from 'vitest'
import { renderMarkdown, RenderScheduler } from './markdown-renderer'

describe('markdown renderer', () => {
  it('renders Markdown and returns source line ranges', () => {
    const result = renderMarkdown('# 标题\n\n正文 **加粗**')
    expect(result.html).toContain('<h1>标题</h1>')
    expect(result.html).toContain('<strong>加粗</strong>')
    expect(result.blocks[0]).toMatchObject({ fromLine: 0, toLineExclusive: 1 })
    expect(result.blocks[1]).toMatchObject({ fromLine: 2, toLineExclusive: 3 })
  })

  it('keeps ordinary line breaks as Markdown semantics and emits GFM tables', () => {
    const result = renderMarkdown('a\nb\n\n| a | b |\n| - | - |\n| 1 | 2 |')
    expect(result.html).toContain('a\nb')
    expect(result.html).toContain('<table>')
  })
})

describe('RenderScheduler', () => {
  it('drops stale revisions and render epochs', async () => {
    const parser = Object.assign(
      (source: string) => Promise.resolve({ html: `<p>${source}</p>`, blocks: [] }),
      {
        dispose: vi.fn(),
      },
    )
    const scheduler = new RenderScheduler(parser, 1)
    const results: string[] = []
    scheduler.subscribe((result) => results.push(result.source))
    scheduler.schedule({ documentId: 'doc', revision: 1, source: 'old' })
    scheduler.schedule({ documentId: 'doc', revision: 2, source: 'new' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(results).toEqual(['new'])
    scheduler.invalidate()
    scheduler.schedule({ documentId: 'doc', revision: 3, source: 'epoch-old', renderEpoch: 0 })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(results).toEqual(['new'])
    scheduler.dispose()
  })
})
