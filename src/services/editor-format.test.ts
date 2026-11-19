import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { formatSelection, type FormatCommand } from './editor-format'

function format(doc: string, command: FormatCommand, from = 0, to = doc.length) {
  const state = EditorState.create({ doc, selection: { anchor: from, head: to } })
  return state.update(formatSelection(state, command)).state.doc.toString()
}

describe('Markdown format commands', () => {
  it('applies line formatting without including the unselected next line', () => {
    expect(format('one\ntwo\nthree', 'format.list', 0, 8)).toBe('- one\n- two\nthree')
    expect(format('# one', 'format.heading')).toBe('## one')
    expect(format('one', 'format.quote')).toBe('> one')
  })

  it('wraps emphasis and uses code delimiters longer than existing backticks', () => {
    expect(format('文档', 'format.bold')).toBe('**文档**')
    expect(format('word', 'format.italic')).toBe('*word*')
    expect(format('word', 'format.strikethrough')).toBe('~~word~~')
    expect(format('`value`', 'format.code')).toBe('`` `value` ``')
    expect(format('```\nvalue\n```', 'format.code')).toBe('````\n```\nvalue\n```\n````\n')
  })

  it('inserts editable link, image and table syntax', () => {
    expect(format('a[b]', 'format.link')).toBe('[a\\[b\\]](https://example.com)')
    expect(format('封面', 'format.image')).toBe('![封面](image.png)')
    expect(format('A|B', 'format.table')).toContain('| A\\|B | 值 |\n| --- | --- |')
  })
})
