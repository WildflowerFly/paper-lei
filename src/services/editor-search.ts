import { isolateHistory } from '@codemirror/commands'
import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search'
import type { EditorView, Panel, ViewUpdate } from '@codemirror/view'

type Match = { from: number; to: number }
const panels = new WeakMap<EditorView, DocumentSearchPanel>()

class DocumentSearchPanel implements Panel {
  readonly dom: HTMLElement
  private readonly keyword: HTMLInputElement
  private readonly replacement: HTMLInputElement
  private readonly replacementRow: HTMLElement
  private readonly status: HTMLElement
  private readonly actions: HTMLButtonElement[]
  private matches: Match[] = []
  private composing = false

  constructor(private readonly view: EditorView) {
    const document = view.dom.ownerDocument
    this.dom = document.createElement('section')
    this.dom.className = 'document-search'
    this.dom.setAttribute('aria-label', '当前文档查找')
    const row = document.createElement('div')
    row.className = 'document-search-row'
    this.keyword = this.input('查找关键词')
    this.keyword.setAttribute('main-field', 'true')
    this.status = document.createElement('output')
    this.status.setAttribute('aria-live', 'polite')
    const previous = this.button('上一个', () => findPrevious(view))
    const next = this.button('下一个', () => findNext(view))
    row.append(
      this.keyword,
      this.status,
      previous,
      next,
      this.button('关闭查找', () => closeSearchPanel(view)),
    )
    this.replacementRow = document.createElement('div')
    this.replacementRow.className = 'document-search-row'
    this.replacementRow.hidden = true
    this.replacement = this.input('替换为')
    const replace = this.button('替换当前', () => this.replace(false))
    const all = this.button('全部替换', () => this.replace(true))
    this.replacementRow.append(this.replacement, replace, all)
    this.actions = [previous, next, replace, all]
    this.dom.append(row, this.replacementRow)
    this.dom.addEventListener('keydown', (event) => {
      if (event.isComposing || this.composing) return
      if (event.key === 'Escape') closeSearchPanel(view)
      else if (event.key === 'Enter' && event.target === this.keyword) {
        if (event.shiftKey) findPrevious(view)
        else findNext(view)
      } else if (event.key === 'Enter' && event.target === this.replacement) this.replace(false)
      else return
      event.preventDefault()
    })
  }

  mount() {
    this.refresh(true)
  }

  update(update: ViewUpdate) {
    const queryChanged = !getSearchQuery(update.startState).eq(getSearchQuery(update.state))
    if (queryChanged || update.docChanged || update.selectionSet)
      this.refresh(queryChanged || update.docChanged)
  }

  destroy() {
    if (panels.get(this.view) === this) panels.delete(this.view)
  }

  show(replace: boolean) {
    this.replacementRow.hidden = !replace
    this.keyword.focus()
    this.keyword.select()
  }

  private input(label: string) {
    const input = this.view.dom.ownerDocument.createElement('input')
    input.type = 'text'
    input.setAttribute('aria-label', label)
    input.placeholder = label
    input.addEventListener('compositionstart', () => (this.composing = true))
    input.addEventListener('compositionend', () => {
      this.composing = false
      this.commitQuery()
    })
    input.addEventListener('input', () => {
      if (!this.composing) this.commitQuery()
    })
    return input
  }

  private button(label: string, command: () => void) {
    const button = this.view.dom.ownerDocument.createElement('button')
    button.type = 'button'
    button.className = 'ui-button'
    button.textContent = label
    button.addEventListener('click', command)
    return button
  }

  private commitQuery() {
    const query = new SearchQuery({
      search: this.keyword.value,
      replace: this.replacement.value,
      literal: true,
    })
    if (!query.eq(getSearchQuery(this.view.state)))
      this.view.dispatch({ effects: setSearchQuery.of(query) })
  }

  private refresh(recount: boolean) {
    const { state } = this.view
    const query = getSearchQuery(state)
    if (this.keyword.value !== query.search) this.keyword.value = query.search
    if (this.replacement.value !== query.replace) this.replacement.value = query.replace
    if (recount) {
      this.matches = []
      if (query.valid) {
        const cursor = query.getCursor(state)
        for (let result = cursor.next(); !result.done; result = cursor.next())
          this.matches.push(result.value)
      }
    }
    const { from, to } = state.selection.main
    const total = this.matches.length
    const current = this.matches.findIndex((match) => match.from === from && match.to === to)
    const status = !query.valid
      ? '输入关键词'
      : !total
        ? '无匹配结果'
        : current < 0
          ? `${total} 个结果`
          : `第 ${current + 1} 项，共 ${total} 项`
    if (this.status.textContent !== status) this.status.textContent = status
    this.actions.forEach(
      (button, index) => (button.disabled = !total || (index >= 2 && state.readOnly)),
    )
  }

  private replace(all: boolean) {
    const { state } = this.view
    if (state.readOnly || !this.matches.length) return
    const { from, to } = state.selection.main
    const current = this.matches.find((match) => from === match.from && to === match.to)
    if (!all && !current) {
      if (!findNext(this.view)) return
      const selected = this.view.state.selection.main
      if (selected.from === from && selected.to === to) return
      this.replace(false)
      return
    }
    const matches = all ? this.matches : [current!]
    this.view.dispatch({
      changes: matches.map((match) => ({ ...match, insert: this.replacement.value })),
      annotations: isolateHistory.of('full'),
      userEvent: 'input.replace',
    })
  }
}

export const documentSearch = search({
  top: true,
  literal: true,
  createPanel(view) {
    const panel = new DocumentSearchPanel(view)
    panels.set(view, panel)
    return panel
  },
})

export function showDocumentSearch(view: EditorView, replace: boolean) {
  openSearchPanel(view)
  panels.get(view)?.show(replace)
}
