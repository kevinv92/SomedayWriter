import { Compartment, EditorState } from '@codemirror/state'
import { EditorView, keymap, drawSelection, type ViewUpdate } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import {
  defaultHighlightStyle,
  indentOnInput,
  syntaxHighlighting
} from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'
import {
  setDiagnostics as setLintDiagnostics,
  type Diagnostic as CmDiagnostic
} from '@codemirror/lint'
import {
  autocompletion,
  completionKeymap,
  type CompletionContext as CmCompletionContext,
  type CompletionResult
} from '@codemirror/autocomplete'
import { vim } from '@replit/codemirror-vim'

import type { EditorAdapter } from './editor-adapter'
import type {
  CompletionSource,
  CursorPosition,
  Diagnostic,
  EditorDoc,
  Range
} from './types'

/**
 * The one place that knows about CodeMirror. Implements the EditorAdapter seam.
 * Tuned for prose: soft wrap, centered measure, serif typography, and no line
 * numbers / code gutter.
 */
class CodeMirrorAdapter implements EditorAdapter {
  private view: EditorView | null = null
  private readonly vimCompartment = new Compartment()
  private vimEnabled = false
  private completionSource: CompletionSource | null = null
  private currentUri = ''
  private readonly changeCbs = new Set<(text: string) => void>()

  mount(parent: HTMLElement): void {
    this.view = new EditorView({ state: this.buildState(''), parent })
  }

  loadDoc(doc: EditorDoc): void {
    this.currentUri = doc.uri
    // Rebuild state so a new document starts with a clean undo history.
    this.requireView().setState(this.buildState(doc.text))
  }

  getText(): string {
    return this.requireView().state.doc.toString()
  }

  onChange(cb: (text: string) => void): () => void {
    this.changeCbs.add(cb)
    return () => this.changeCbs.delete(cb)
  }

  setDiagnostics(diagnostics: Diagnostic[]): void {
    const view = this.requireView()
    const cm: CmDiagnostic[] = diagnostics.map((d) => ({
      from: d.from,
      to: d.to,
      severity: d.severity,
      message: d.message,
      source: d.source
    }))
    view.dispatch(setLintDiagnostics(view.state, cm))
  }

  setCompletionSource(source: CompletionSource | null): void {
    this.completionSource = source
  }

  focusRange(range: Range): void {
    const view = this.requireView()
    view.dispatch({
      selection: { anchor: range.from, head: range.to },
      scrollIntoView: true
    })
    view.focus()
  }

  getCursor(): CursorPosition {
    const { state } = this.requireView()
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    return { offset: head, line: line.number, column: head - line.from + 1 }
  }

  setVimMode(enabled: boolean): void {
    this.vimEnabled = enabled
    this.requireView().dispatch({
      effects: this.vimCompartment.reconfigure(enabled ? vim() : [])
    })
  }

  dispose(): void {
    this.changeCbs.clear()
    this.view?.destroy()
    this.view = null
  }

  // --- internals ---

  private buildState(text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        // Vim must sit first so its keymap wins when active.
        this.vimCompartment.of(this.vimEnabled ? vim() : []),
        history(),
        drawSelection(),
        indentOnInput(),
        markdown(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        EditorView.lineWrapping,
        autocompletion({ override: [this.completionDelegate], activateOnTyping: true }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...completionKeymap]),
        EditorView.updateListener.of(this.handleUpdate),
        proseTheme
      ]
    })
  }

  private readonly handleUpdate = (update: ViewUpdate): void => {
    if (!update.docChanged) return
    const text = update.state.doc.toString()
    this.changeCbs.forEach((cb) => cb(text))
  }

  /**
   * Bridges CM's pull-based completion to our editor-agnostic CompletionSource.
   * Recognizes `@mention` tokens (the character-linking convention) and asks the
   * registered source for candidates; the range logic stays editor-side.
   */
  private readonly completionDelegate = async (
    ctx: CmCompletionContext
  ): Promise<CompletionResult | null> => {
    const source = this.completionSource
    if (!source) return null
    const token = ctx.matchBefore(/@\w*/)
    if (!token) return null
    const results = await source({ text: ctx.state.doc.toString(), offset: ctx.pos })
    if (!results || results.length === 0) return null
    return {
      from: token.from,
      options: results.map((r) => ({
        label: r.label,
        apply: r.apply ?? r.label,
        detail: r.detail,
        type: r.type
      }))
    }
  }

  private requireView(): EditorView {
    if (!this.view) throw new Error('EditorAdapter used before mount()')
    return this.view
  }
}

const proseTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '16px', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'Georgia, "Iowan Old Style", "Times New Roman", serif',
    lineHeight: '1.7',
    overflow: 'auto'
  },
  '.cm-content': {
    maxWidth: '46rem',
    margin: '0 auto',
    padding: '2.5rem 1.5rem 40vh'
  }
})

export function createCodeMirrorAdapter(): EditorAdapter {
  return new CodeMirrorAdapter()
}
