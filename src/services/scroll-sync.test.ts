import { describe, expect, it } from 'vitest'
import {
  findPreviewAnchor,
  interpolateBlockScroll,
  scrollForPreviewAnchor,
  ScrollSyncGuard,
  type ScrollBlock,
} from './scroll-sync'

const blocks: ScrollBlock[] = [
  { blockId: 'heading', fromLine: 0, toLineExclusive: 2, top: 0, bottom: 80 },
  { blockId: 'paragraph', fromLine: 3, toLineExclusive: 7, top: 120, bottom: 320 },
]

describe('scroll mapping', () => {
  it('interpolates within a source block instead of using document percentage', () => {
    expect(interpolateBlockScroll(blocks[1]!, 5)).toBe(220)
  })

  it('round trips a preview anchor and falls back by source line', () => {
    const anchor = findPreviewAnchor(blocks, 190)
    expect(anchor).toMatchObject({ blockId: 'paragraph' })
    expect(scrollForPreviewAnchor(blocks, anchor!)).toBe(190)
    expect(scrollForPreviewAnchor(blocks, { blockId: 'removed', offset: 0.5, sourceLine: 5 })).toBe(
      220,
    )
  })
})

describe('scroll sync guard', () => {
  it('consumes one programmatic target event without creating a loop', () => {
    const guard = new ScrollSyncGuard()
    guard.expect('preview', 240)
    expect(guard.consume('source', 240)).toBe(false)
    expect(guard.consume('preview', 240)).toBe(true)
    expect(guard.consume('preview', 240)).toBe(false)
    guard.expect('preview', 200)
    expect(guard.consume('preview', 160)).toBe(false)
  })
})
