import { describe, expect, it } from 'vitest'
import { SourceMapService } from './source-map'

describe('SourceMapService', () => {
  it('resolves controlled block ids to zero-based source lines', () => {
    const service = new SourceMapService()
    service.setBlocks([
      { blockId: 'block-0', fromLine: 0, toLineExclusive: 1, kind: 'heading_open' },
      { blockId: 'block-1', fromLine: 2, toLineExclusive: 4, kind: 'paragraph_open' },
    ])
    expect(service.getLine('block-1')).toBe(2)
    expect(service.getBlock('block-0')?.kind).toBe('heading_open')
    expect(service.getLine('user-content-block-1')).toBeUndefined()
  })
})
