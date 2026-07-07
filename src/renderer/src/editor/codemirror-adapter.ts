import { Compartment, EditorState, RangeSetBuilder } from '@codemirror/state'
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
import { search, searchKeymap, highlightSelectionMatches } from '@codemirror/search'
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
  private goToDefinition: ((ctx: { lineText: string; column: number }) => void) | null =
    null

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

  focusLine(line: number, column = 1, endColumn?: number): void {
    const view = this.requireView()
    const { doc } = view.state
    const target = doc.line(Math.min(Math.max(line, 1), doc.lines))
    const pos = Math.min(target.from + Math.max(column - 1, 0), target.to)
    // With an end column, select the span (e.g. the matched mention) so it's
    // visibly highlighted; otherwise just place the caret.
    const head =
      endColumn != null
        ? Math.min(target.from + Math.max(endColumn - 1, 0), target.to)
        : pos
    view.dispatch({ selection: { anchor: pos, head }, scrollIntoView: true })
    view.focus()
  }

  getCursor(): CursorPosition {
    const { state } = this.requireView()
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    return { offset: head, line: line.number, column: head - line.from + 1 }
  }

  getCursorContext(): { lineText: string; column: number } {
    const { state } = this.requireView()
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    return { lineText: line.text, column: head - line.from + 1 }
  }

  setGoToDefinition(
    handler: ((ctx: { lineText: string; column: number }) => void) | null
  ): void {
    this.goToDefinition = handler
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
        frontmatterPlugin,
        EditorView.lineWrapping,
        // In-document find/replace (Cmd/Ctrl+F) — M5. `top` puts the panel above
        // the text rather than at the bottom, which reads better for prose.
        search({ top: true }),
        highlightSelectionMatches(),
        autocompletion({ override: [this.completionDelegate], activateOnTyping: true }),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...searchKeymap
        ]),
        EditorView.updateListener.of(this.handleUpdate),
        // Cmd/Ctrl+click a mention → go-to-definition (VS Code's gesture). We
        // hand the clicked line + column to the registered resolver, which owns
        // the StoryIndex lookup and opens the profile.
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (!this.goToDefinition || !(event.metaKey || event.ctrlKey)) return false
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos == null) return false
            const line = view.state.doc.lineAt(pos)
            event.preventDefault()
            this.goToDefinition({ lineText: line.text, column: pos - line.from + 1 })
            return true
          }
        }),
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
   * Two trigger contexts, both with editor-side range logic: `@mention` tokens
   * anywhere (entity linking), and any word inside the leading `---` frontmatter
   * block (Phase 7 M19 key/value intellisense). The registered providers decide
   * what to offer for the position; here we only pick the replacement range.
   */
  private readonly completionDelegate = async (
    ctx: CmCompletionContext
  ): Promise<CompletionResult | null> => {
    const source = this.completionSource
    if (!source) return null
    let from: number
    if (inFrontmatter(ctx.state, ctx.pos)) {
      const word = ctx.matchBefore(/[\w-]*/)
      from = word ? word.from : ctx.pos
      // Don't pop an empty list open on its own; wait for a keystroke or an
      // explicit invoke (Ctrl+Space).
      if (!ctx.explicit && from === ctx.pos) return null
    } else {
      const token = ctx.matchBefore(/@\w*/)
      if (!token) return null
      from = token.from
    }
    const results = await source({ text: ctx.state.doc.toString(), offset: ctx.pos })
    if (!results || results.length === 0) return null
    return {
      from,
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
 * A leading `---` … `---` block is YAML frontmatter, but the Markdown parser
 * doesn't know that — it reads `text\n---` as a setext H2, so the last metadata
 * line renders as a giant heading. Tag every line of the block so CSS can style
 * it as compact, dimmed metadata (and neutralise the stray heading styling).
 */
const frontmatterLine = Decoration.line({ class: 'cm-frontmatter-line' })

function frontmatterDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const { doc } = view.state
  if (doc.lines >= 2 && doc.line(1).text.trim() === '---') {
    let close = -1
    for (let n = 2; n <= doc.lines; n++) {
      if (doc.line(n).text.trim() === '---') {
        close = n
        break
      }
    }
    if (close !== -1) {
      for (let n = 1; n <= close; n++) {
        builder.add(doc.line(n).from, doc.line(n).from, frontmatterLine)
      }
    }
  }
  return builder.finish()
}

/** True when `pos` sits inside the leading `---` … `---` frontmatter body (not on
 * a fence line) — the trigger region for frontmatter intellisense (M19). Mirrors
 * the decoration's block detection, but keyed to a cursor position. */
function inFrontmatter(state: EditorState, pos: number): boolean {
  const { doc } = state
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return false
  let close = -1
  for (let n = 2; n <= doc.lines; n++) {
    if (doc.line(n).text.trim() === '---') {
      close = n
      break
    }
  }
  const line = doc.lineAt(pos).number
  const last = close === -1 ? doc.lines : close - 1
  return line >= 2 && line <= last
}

const frontmatterPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = frontmatterDecorations(view)
    }
    update(update: ViewUpdate) {
      // Frontmatter only sits at the top; recompute only when the doc changes.
      if (update.docChanged) this.decorations = frontmatterDecorations(update.view)
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
  // Typography is driven by CSS vars (set from editor.* in project.json) with the
  // hard-coded prose defaults as fallbacks.
  '&': {
    height: '100%',
    fontSize: 'var(--editor-font-size, 16px)',
    backgroundColor: 'transparent'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily:
      'var(--editor-font, Georgia, "Iowan Old Style", "Times New Roman", serif)',
    lineHeight: 'var(--editor-line-height, 1.7)',
    overflow: 'auto'
  },
  '.cm-content': {
    // Text-column width ("measure"). Driven by --editor-measure (set from
    // editor.measure in project.json); falls back to a comfortable 46rem.
    maxWidth: 'var(--editor-measure, 46rem)',
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
  // In-file find panel (Cmd/Ctrl+F) — styled to match the app's inputs/buttons
  // (the project-search panel, modals, quick-input) so the two find surfaces read
  // as one visual language (M16). Full design-system unification is Phase 11.
  '.cm-panels': {
    backgroundColor: 'var(--panel)',
    color: 'var(--fg)',
    borderBottom: '1px solid var(--border)'
  },
  '.cm-panel.cm-search': {
    padding: '0.45rem 0.6rem',
    fontFamily: 'inherit',
    fontSize: '0.82rem'
  },
  '.cm-panel.cm-search label': { fontSize: '0.75rem', color: 'var(--muted)' },
  '.cm-textfield': {
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    background: 'var(--bg)',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.25rem 0.45rem'
  },
  '.cm-textfield:focus': { outline: 'none', borderColor: 'var(--accent)' },
  '.cm-button': {
    fontFamily: 'inherit',
    fontSize: '0.8rem',
    background: 'var(--bg)',
    backgroundImage: 'none',
    color: 'var(--fg)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    padding: '0.2rem 0.55rem',
    cursor: 'pointer'
  },
  '.cm-button:hover': { borderColor: 'var(--accent)' },
  '.cm-panel.cm-search [name=close]': {
    color: 'var(--muted)',
    cursor: 'pointer',
    fontSize: '1.1rem'
  },
  '.cm-searchMatch': { backgroundColor: 'rgba(234, 179, 8, 0.32)', borderRadius: '2px' },
  '.cm-searchMatch-selected': {
    backgroundColor: 'var(--accent)',
    color: 'var(--accent-fg)'
  },
  // Autocomplete popup (@-mentions) — theme it so it's legible in light + dark
  // (CM's defaults render faint on our white background).
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--panel)',
    border: '1px solid var(--border)',
    borderRadius: '6px',
    color: 'var(--fg)',
    boxShadow: '0 4px 16px rgba(0, 0, 0, 0.22)'
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'inherit',
    fontSize: '0.9rem'
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: '0.15rem 0.5rem',
    color: 'var(--fg)'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--accent)',
    color: 'var(--accent-fg)'
  },
  '.cm-completionLabel': { color: 'inherit' },
  '.cm-completionDetail': { color: 'var(--muted)', fontStyle: 'italic' },
  'li[aria-selected] .cm-completionDetail': { color: 'var(--accent-fg)' },
  // Frontmatter block: compact, dimmed metadata. `!important` + the descendant
  // selector override the setext-heading styling the parser applies to the last
  // line before the closing `---`.
  '.cm-frontmatter-line, .cm-frontmatter-line *': {
    fontSize: '0.8rem !important',
    fontWeight: 'normal !important',
    fontStyle: 'normal !important',
    lineHeight: '1.35 !important',
    color: 'var(--muted) !important',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace !important'
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
