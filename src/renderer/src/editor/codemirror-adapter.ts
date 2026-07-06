import { Compartment, EditorState } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  drawSelection,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { tags as t } from '@lezer/highlight'
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
        syntaxHighlighting(proseHighlightStyle),
        notesPlugin,
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

/**
 * Inline `%% note to self %%` comments (Obsidian-compatible). Styled as
 * de-emphasized asides so they don't read as prose; the export step strips them.
 * Single-line only for now.
 */
const noteMatcher = new MatchDecorator({
  regexp: /%%[^\n]*?%%/g,
  decoration: Decoration.mark({ class: 'cm-note' })
})

const notesPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = noteMatcher.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = noteMatcher.updateDeco(update, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * Styles Markdown *source* in place so it reads like prose while staying
 * editable text (Obsidian-style): headings render larger, strong/emphasis are
 * bold/italic, and the syntax marks (`#`, `**`, `_`) are dimmed rather than
 * hidden. No colored code-editor tokens.
 */
const proseHighlightStyle = HighlightStyle.define([
  { tag: t.heading1, fontSize: '1.8em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading2, fontSize: '1.5em', fontWeight: '700', lineHeight: '1.3' },
  { tag: t.heading3, fontSize: '1.25em', fontWeight: '700' },
  { tag: [t.heading4, t.heading5, t.heading6], fontWeight: '700' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)', textDecoration: 'underline' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  { tag: t.quote, color: 'var(--muted)', fontStyle: 'italic' },
  // Dim the literal Markdown syntax marks.
  { tag: [t.processingInstruction, t.meta], color: 'var(--muted)', fontWeight: '400' }
])

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
    padding: '2.5rem 1.5rem 40vh',
    // Follow the theme so the caret is visible on both light and dark bg.
    caretColor: 'var(--fg)'
  },
  // `drawSelection()` renders its own caret/selection; without explicit colors
  // they default to black + a near-invisible tint, so tie them to the theme.
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--fg)' },
  '&.cm-focused .cm-cursor': { borderLeftColor: 'var(--fg)' },
  '.cm-selectionBackground': { backgroundColor: 'rgba(120, 130, 150, 0.3)' },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(37, 99, 235, 0.35)'
  },
  // Inline `%% note %%` comments: a quiet aside, not prose.
  '.cm-note': {
    color: 'var(--muted)',
    backgroundColor: 'rgba(120, 120, 120, 0.12)',
    fontStyle: 'italic',
    fontSize: '0.9em',
    borderRadius: '3px',
    padding: '0 2px'
  },
  // Make diagnostics obvious: a tinted highlight behind the span plus a thicker
  // wavy underline (overriding CM's faint default).
  '.cm-lintRange-warning': {
    backgroundImage: 'none',
    backgroundColor: 'rgba(217, 119, 6, 0.22)',
    textDecoration: 'underline wavy #d97706',
    textDecorationThickness: '2px',
    borderRadius: '2px'
  },
  '.cm-lintRange-error': {
    backgroundImage: 'none',
    backgroundColor: 'rgba(220, 38, 38, 0.22)',
    textDecoration: 'underline wavy #dc2626',
    textDecorationThickness: '2px',
    borderRadius: '2px'
  },
  '.cm-lintRange-info': {
    backgroundImage: 'none',
    backgroundColor: 'rgba(37, 99, 235, 0.18)',
    textDecoration: 'underline wavy #2563eb',
    textDecorationThickness: '2px',
    borderRadius: '2px'
  }
})

export function createCodeMirrorAdapter(): EditorAdapter {
  return new CodeMirrorAdapter()
}
