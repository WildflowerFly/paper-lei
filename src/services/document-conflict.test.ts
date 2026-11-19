import { describe, expect, it } from 'vitest'
import { createConflictSession, diskVersionChanged } from './document-conflict'

describe('document conflict sessions', () => {
  it('retains base and both competing text versions', () => {
    expect(createConflictSession('doc', 'base', 'local', null)).toMatchObject({
      base: 'base',
      local: 'local',
      disk: null,
      reason: 'missing',
    })
  })

  it('detects content and identity changes but ignores timestamp-only changes', () => {
    const original = { fileId: 'a', hash: 'one', length: 3, modified: 1 }
    expect(diskVersionChanged(original, { ...original, modified: 2 })).toBe(false)
    expect(diskVersionChanged(original, { ...original, hash: 'two' })).toBe(true)
    expect(diskVersionChanged(original, { ...original, fileId: 'b' })).toBe(true)
  })
})
