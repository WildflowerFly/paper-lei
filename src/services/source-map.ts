import type { SourceBlock } from './markdown-renderer'

export class SourceMapService {
  private blocks = new Map<string, SourceBlock>()

  setBlocks(blocks: SourceBlock[]) {
    this.blocks = new Map(blocks.map((block) => [block.blockId, block]))
  }

  getBlock(blockId: string) {
    return this.blocks.get(blockId)
  }

  getLine(blockId: string) {
    return this.blocks.get(blockId)?.fromLine
  }

  clear() {
    this.blocks.clear()
  }
}
