import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands'
import {
  bracketMatching,
  defaultHighlightStyle,
  foldGutter,
  indentUnit,
  indentOnInput,
  syntaxHighlighting,
} from '@codemirror/language'
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
  type Transaction,
  type TransactionSpec,
} from '@codemirror/state'
import {
  Decoration,
  keymap,
  lineNumbers,
  highlightActiveLine,
  drawSelection,
  EditorView,
  type DecorationSet,
} from '@codemirror/view'

const setSourceHighlight = StateEffect.define<{ from: number } | null>()
const sourceHighlight = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, transaction) {
    let next = value.map(transaction.changes)
    for (const effect of transaction.effects) {
      if (!effect.is(setSourceHighlight)) continue
      next = effect.value
        ? Decoration.set([
            Decoration.line({ class: 'cm-source-highlight' }).range(effect.value.from),
          ])
        : Decoration.none
    }
    return next
  },
  provide: (field) => EditorView.decorations.from(field),
})

export type EditorSession = {
  id: string
  state: EditorState
  savedText: string
  revision: number
  scrollTop: number
}

export type EditorOptions = {
  lineWrapping?: boolean
  fontSize?: number
}

export type EditorChange = {
  id: string
  revision: number
  dirty: boolean
}

const baseExtensions: Extension = [
  lineNumbers(),
  foldGutter(),
  history(),
  drawSelection(),
  highlightActiveLine(),
  bracketMatching(),
  indentOnInput(),
  syntaxHighlighting(defaultHighlightStyle),
  keymap.of([...defaultKeymap, ...historyKeymap]),
  markdown(),
  EditorState.tabSize.of(2),
  indentUnit.of('  '),
  EditorState.allowMultipleSelections.of(true),
  sourceHighlight,
]

export class EditorRegistry {
  private readonly sessions = new Map<string, EditorSession>()
  private activeId: string | null = null
  private view: EditorView | null = null
  private options: EditorOptions = {}
  private readonly listeners = new Set<(change: EditorChange) => void>()
  private readonly scrollListeners = new Set<(id: string) => void>()

  subscribe(listener: (change: EditorChange) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  subscribeScroll(listener: (id: string) => void) {
    this.scrollListeners.add(listener)
    return () => this.scrollListeners.delete(listener)
  }

  register(id: string, text: string, savedText = text) {
    if (this.sessions.has(id)) return this.sessions.get(id)!
    const session: EditorSession = {
      id,
      state: this.createState(id, text),
      savedText,
      revision: 0,
      scrollTop: 0,
    }
    this.sessions.set(id, session)
    return session
  }

  has(id: string) {
    return this.sessions.has(id)
  }

  get(id: string) {
    return this.sessions.get(id)
  }

  getText(id: string) {
    return this.sessions.get(id)?.state.doc.toString() ?? ''
  }

  isDirty(id: string) {
    const session = this.sessions.get(id)
    return session ? session.state.doc.toString() !== session.savedText : false
  }

  markSaved(id: string) {
    const session = this.require(id)
    session.savedText = session.state.doc.toString()
  }

  dispatch(id: string, spec: TransactionSpec) {
    const session = this.require(id)
    const transaction = session.state.update(spec)
    this.applyTransaction(id, transaction)
  }

  activate(id: string, parent: HTMLElement, options: EditorOptions = {}) {
    this.require(id)
    this.options = options
    if (!this.view) {
      this.activeId = id
      this.view = new EditorView({
        state: this.require(id).state,
        parent,
        dispatch: (transaction) => this.dispatchActive(transaction),
      })
      this.view.scrollDOM.addEventListener('scroll', this.handleScroll, { passive: true })
    } else {
      if (this.activeId) {
        const current = this.require(this.activeId)
        current.scrollTop = this.view.scrollDOM.scrollTop
      }
      this.activeId = id
      this.view.setState(this.require(id).state)
      requestAnimationFrame(() => {
        if (this.view && this.activeId === id)
          this.view.scrollDOM.scrollTop = this.require(id).scrollTop
      })
    }
    this.configureView()
    return this.view
  }

  updateOptions(options: EditorOptions) {
    this.options = options
    this.configureView()
  }

  undo() {
    if (this.view) undo(this.view)
  }

  redo() {
    if (this.view) redo(this.view)
  }

  revealLine(line: number) {
    if (!this.view || !this.activeId) return false
    const documentLine = Math.min(this.view.state.doc.lines, Math.max(1, line + 1))
    const from = this.view.state.doc.line(documentLine).from
    const to = this.view.state.doc.line(documentLine).to
    this.view.dispatch({
      selection: { anchor: from, head: to },
      effects: [setSourceHighlight.of({ from })],
      scrollIntoView: true,
    })
    window.setTimeout(() => {
      if (this.view && this.activeId) this.view.dispatch({ effects: setSourceHighlight.of(null) })
    }, 900)
    return true
  }

  scrollElement() {
    return this.view?.scrollDOM
  }

  sourceLineAtViewportTop() {
    const view = this.view
    if (!view?.scrollDOM.clientHeight) return undefined
    const height = view.scrollDOM.getBoundingClientRect().top - view.documentTop
    const block = view.lineBlockAtHeight(height)
    const offset = Math.max(0, Math.min(1, (height - block.top) / Math.max(1, block.height)))
    return view.state.doc.lineAt(block.from).number - 1 + offset
  }

  scrollTopForSourceLine(sourceLine: number) {
    const view = this.view
    if (!view?.scrollDOM.clientHeight) return undefined
    const line = Math.min(view.state.doc.lines, Math.floor(sourceLine) + 1)
    const block = view.lineBlockAt(view.state.doc.line(line).from)
    const documentOrigin =
      view.documentTop - view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.scrollTop
    return documentOrigin + block.top + (sourceLine % 1) * block.height
  }

  activeDocument() {
    return this.activeId
  }

  destroy() {
    if (this.activeId && this.view)
      this.require(this.activeId).scrollTop = this.view.scrollDOM.scrollTop
    if (this.view) this.view.scrollDOM.removeEventListener('scroll', this.handleScroll)
    this.view?.destroy()
    this.view = null
    this.activeId = null
  }

  private handleScroll = () => {
    if (this.activeId) {
      for (const listener of this.scrollListeners) listener(this.activeId)
    }
  }

  private createState(id: string, text: string) {
    return EditorState.create({
      doc: text,
      extensions: [
        baseExtensions,
        EditorView.domEventHandlers({
          compositionend: () => {
            return false
          },
        }),
        EditorView.contentAttributes.of({
          'aria-label': '源码编辑器',
          'aria-multiline': 'true',
          'data-document-id': id,
        }),
      ],
    })
  }

  private configureView() {
    if (!this.view) return
    const className = this.options.lineWrapping ? 'cm-lineWrapping' : ''
    this.view.dom.classList.toggle('cm-lineWrapping', Boolean(className))
    this.view.dom.style.setProperty('--editor-font-size', `${this.options.fontSize ?? 14}px`)
  }

  private applyTransaction(id: string, transaction: Transaction) {
    const session = this.require(id)
    session.state = transaction.state
    if (transaction.docChanged) session.revision += 1
    if (transaction.docChanged) {
      const change = { id, revision: session.revision, dirty: this.isDirty(id) }
      for (const listener of this.listeners) listener(change)
    }
    if (this.view && this.activeId === id && this.view.state !== transaction.state) {
      this.view.update([transaction])
    }
  }

  private dispatchActive(transaction: Transaction) {
    if (this.activeId) this.applyTransaction(this.activeId, transaction)
  }

  private require(id: string) {
    const session = this.sessions.get(id)
    if (!session) throw new Error(`Unknown editor document: ${id}`)
    return session
  }
}
