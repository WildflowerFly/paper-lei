import { describe, expect, it } from 'vitest'
import { EditorRegistry } from './editor-registry'

describe('EditorRegistry', () => {
  it('counts tabs, combining marks and joined emoji as single cursor columns', () => {
    const registry = new EditorRegistry()
    const line = '\t👩‍💻e\u0301'
    registry.register('cursor', `first\n${line}`)
    registry.dispatch('cursor', { selection: { anchor: 6 + line.length } })
    expect(registry.cursorPosition('cursor')).toEqual({ line: 2, column: 4 })
  })

  it('keeps independent text, revision and dirty state per document', () => {
    const registry = new EditorRegistry()
    registry.register('a', 'alpha')
    registry.register('b', 'beta')
    registry.dispatch('a', { changes: { from: 5, insert: '!' } })
    expect(registry.getText('a')).toBe('alpha!')
    expect(registry.getText('b')).toBe('beta')
    expect(registry.get('a')?.revision).toBe(1)
    expect(registry.isDirty('a')).toBe(true)
    expect(registry.isDirty('b')).toBe(false)
    registry.markSaved('a')
    expect(registry.isDirty('a')).toBe(false)
  })

  it('preserves undo history for a document when another document changes', () => {
    const registry = new EditorRegistry()
    registry.register('a', 'one')
    registry.register('b', 'two')
    registry.dispatch('a', { changes: { from: 3, insert: '!' }, annotations: [] })
    registry.dispatch('b', { changes: { from: 3, insert: '?' }, annotations: [] })
    expect(registry.getText('a')).toBe('one!')
    expect(registry.getText('b')).toBe('two?')
    registry.dispatch('a', { changes: { from: 0, insert: 'A' }, annotations: [] })
    expect(registry.getText('a')).toBe('Aone!')
    registry.dispatch('a', { changes: { from: 0, to: 1 }, annotations: [] })
    expect(registry.getText('a')).toBe('one!')
  })

  it('emits ordered revision changes and rejects unknown documents', () => {
    const registry = new EditorRegistry()
    const changes: number[] = []
    registry.subscribe(({ revision }) => changes.push(revision))
    registry.register('a', '')
    registry.dispatch('a', { changes: { from: 0, insert: 'x' } })
    registry.dispatch('a', { changes: { from: 1, insert: 'y' } })
    expect(changes).toEqual([1, 2])
    expect(() => registry.getText('missing')).not.toThrow()
    expect(() => registry.dispatch('missing', { changes: { from: 0, insert: 'x' } })).toThrow(
      'Unknown editor document',
    )
  })

  it('keeps read-only documents from accepting edits', () => {
    const registry = new EditorRegistry()
    registry.register('readonly', 'locked', 'locked', true)
    registry.dispatch('readonly', { changes: { from: 0, insert: 'x' } })
    expect(registry.getText('readonly')).toBe('locked')
    expect(registry.get('readonly')?.revision).toBe(0)
  })
})
