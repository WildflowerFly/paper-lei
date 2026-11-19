import { isolateHistory } from '@codemirror/commands'
import { EditorSelection, type EditorState, type TransactionSpec } from '@codemirror/state'
import type { CommandId } from './commands'

export type FormatCommand = Extract<CommandId, `format.${string}`>

const linePrefixes = {
  'format.heading': '## ',
  'format.list': '- ',
  'format.quote': '> ',
} as const

function isLineCommand(command: FormatCommand): command is keyof typeof linePrefixes {
  return Object.hasOwn(linePrefixes, command)
}

function codeFence(text: string, minimum: number) {
  const runs = text.matchAll(/`+/g)
  let length = minimum
  for (const run of runs) length = Math.max(length, run[0].length + 1)
  return '`'.repeat(length)
}

export function formatSelection(state: EditorState, command: FormatCommand): TransactionSpec {
  const transaction = { annotations: isolateHistory.of('full'), userEvent: 'input.format' }
  if (isLineCommand(command)) {
    const lines = new Set<number>()
    for (const range of state.selection.ranges) {
      const start = state.doc.lineAt(range.from).number
      const end = state.doc.lineAt(range.empty ? range.from : range.to - 1).number
      for (let line = start; line <= end; line++) lines.add(line)
    }
    const changes = [...lines]
      .sort((left, right) => left - right)
      .flatMap((number) => {
        const line = state.doc.line(number)
        const heading =
          command === 'format.heading' ? /^ {0,3}#{1,6}(?:\s+|$)/.exec(line.text) : null
        const prefix = linePrefixes[command]
        if (line.text.startsWith(prefix)) return []
        return [{ from: line.from, to: line.from + (heading?.[0].length ?? 0), insert: prefix }]
      })
    return { ...transaction, changes }
  }

  return {
    ...transaction,
    ...state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)
      const word = text || '文本'
      let left = ''
      let body = word
      let right = ''
      switch (command) {
        case 'format.bold':
          left = right = '**'
          break
        case 'format.italic':
          left = right = '*'
          break
        case 'format.strikethrough':
          left = right = '~~'
          break
        case 'format.code': {
          const multiline = text.includes('\n')
          const fence = codeFence(text, multiline ? 3 : 1)
          if (multiline) {
            left = `${range.from === state.doc.lineAt(range.from).from ? '' : '\n'}${fence}\n`
            right = `${text.endsWith('\n') ? '' : '\n'}${fence}\n`
          } else {
            const padding = /(^[` ]|[` ]$)/.test(word) && /\S/.test(word) ? ' ' : ''
            left = fence + padding
            right = padding + fence
          }
          body = text || '代码'
          break
        }
        case 'format.link':
        case 'format.image':
          left = command === 'format.image' ? '![' : '['
          body = (text || (command === 'format.image' ? '图片说明' : '链接文字'))
            .replace(/\s*\n\s*/g, ' ')
            .replace(/[\\[\]]/g, '\\$&')
          right = command === 'format.image' ? '](image.png)' : '](https://example.com)'
          break
        case 'format.table':
          left = `${range.from === 0 ? '' : '\n\n'}| `
          body = (text || '列名').replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|')
          right = ' | 值 |\n| --- | --- |\n| 内容 | 内容 |\n\n'
          break
      }
      const anchor = range.from + left.length
      return {
        changes: { from: range.from, to: range.to, insert: left + body + right },
        range: EditorSelection.range(anchor, anchor + body.length),
      }
    }),
  }
}
