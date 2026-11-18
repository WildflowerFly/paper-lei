import { describe, expect, it } from 'vitest'
import { makeFixture } from '../../scripts/generate-fixtures.mjs'

describe('synthetic performance fixtures', () => {
  for (const [kind, marker] of [
    ['prose', '中文'],
    ['code', '```ts'],
    ['mixed', '```mermaid'],
  ] as const) {
    for (const size of [1, 5, 10]) {
      it(`${kind} ${size} MiB is deterministic and valid UTF-8`, () => {
        const fixture = makeFixture(kind, size * 1024 ** 2)
        expect(fixture.byteLength).toBe(size * 1024 ** 2)
        expect(new TextDecoder('utf-8', { fatal: true }).decode(fixture)).toContain(marker)
        expect(fixture.equals(makeFixture(kind, size * 1024 ** 2))).toBe(true)
      })
    }
  }
})
