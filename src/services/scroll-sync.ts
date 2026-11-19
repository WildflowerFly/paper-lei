export type ScrollBlock = {
  blockId: string
  fromLine: number
  toLineExclusive: number
  top: number
  bottom: number
}

export type ScrollAnchor = {
  blockId: string
  offset: number
  sourceLine: number
}

export function clampScroll(value: number, maximum: number) {
  return Math.min(Math.max(0, value), Math.max(0, maximum))
}

export function interpolateBlockScroll(block: ScrollBlock, sourceLine: number) {
  const lineCount = Math.max(1, block.toLineExclusive - block.fromLine)
  const progress = Math.min(1, Math.max(0, (sourceLine - block.fromLine) / lineCount))
  return block.top + (block.bottom - block.top) * progress
}

export function findBlockForSourceLine(blocks: ScrollBlock[], line: number) {
  const index = firstAfter(blocks, (block) => block.toLineExclusive <= line)
  const next = blocks[index]
  const previous = blocks[index - 1]
  if (!next) return previous
  if (!previous || line >= next.fromLine || next.fromLine - line < line - previous.toLineExclusive)
    return next
  return previous
}

function firstAfter(blocks: ScrollBlock[], isBefore: (block: ScrollBlock) => boolean) {
  let start = 0
  let end = blocks.length
  while (start < end) {
    const midpoint = Math.floor((start + end) / 2)
    if (isBefore(blocks[midpoint]!)) start = midpoint + 1
    else end = midpoint
  }
  return start
}

export function findPreviewAnchor(blocks: ScrollBlock[], scrollTop: number): ScrollAnchor | null {
  const block =
    blocks[firstAfter(blocks, (candidate) => candidate.bottom <= scrollTop)] ?? blocks.at(-1)
  if (!block) return null
  const height = Math.max(1, block.bottom - block.top)
  const offset = scrollTop < block.top ? scrollTop - block.top : (scrollTop - block.top) / height
  const sourceLine =
    block.fromLine + clampScroll(offset, 1) * Math.max(1, block.toLineExclusive - block.fromLine)
  return { blockId: block.blockId, offset, sourceLine }
}

export function scrollForPreviewAnchor(blocks: ScrollBlock[], anchor: ScrollAnchor) {
  const block = blocks.find((candidate) => candidate.blockId === anchor.blockId)
  if (block)
    return (
      block.top + (anchor.offset < 0 ? anchor.offset : (block.bottom - block.top) * anchor.offset)
    )
  const nearest = findBlockForSourceLine(blocks, anchor.sourceLine)
  return nearest ? interpolateBlockScroll(nearest, anchor.sourceLine) : 0
}

export type ScrollPane = 'preview' | 'source'

export class ScrollSyncGuard {
  private readonly pending = new Map<ScrollPane, number>()

  expect(target: ScrollPane, position: number) {
    this.pending.set(target, position)
  }

  consume(target: ScrollPane, position: number) {
    const expected = this.pending.get(target)
    this.pending.delete(target)
    return expected !== undefined && Math.abs(expected - position) <= 1
  }

  clear(target?: ScrollPane) {
    if (target) this.pending.delete(target)
    else this.pending.clear()
  }
}
