import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  type Extension
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  keymap,
  drawSelection,
  lineNumbers,
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
import { vim, getCM } from '@replit/codemirror-vim'

import type { EditorAdapter, FormatAction } from './editor-adapter'
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
  private readonly vimModeCbs = new Set<(mode: string) => void>()
  private cmVimOff: (() => void) | null = null
  private goToDefinition: ((ctx: { lineText: string; column: number }) => void) | null =
    null

  mount(parent: HTMLElement): void {
    this.view = new EditorView({ state: this.buildState(''), parent })
  }

  loadDoc(doc: EditorDoc): void {
    this.currentUri = doc.uri
    // Rebuild state so a new document starts with a clean undo history.
    this.requireView().setState(this.buildState(doc.text))
    // setState mints a fresh CM instance, so re-bind the vim mode listener.
    if (this.vimEnabled) this.syncVimListener()
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
      effects: this.vimCompartment.reconfigure(this.vimBundle())
    })
    this.syncVimListener()
  }

  /** Vim-mode editor extensions. Vim keys must sit first so its keymap wins;
   * line numbers ride along so `:42` / `42G` jumps have visible targets. */
  private vimBundle(): Extension {
    return this.vimEnabled ? [vim(), lineNumbers()] : []
  }

  /** Subscribe to Vim mode changes ('normal' | 'insert' | 'visual' | 'replace',
   * or '' when Vim is off). Returns an unsubscribe fn. Drives the status-bar
   * mode chip and the mode-coloured cursor. */
  onVimModeChange(cb: (mode: string) => void): () => void {
    this.vimModeCbs.add(cb)
    return () => this.vimModeCbs.delete(cb)
  }

  /** Apply a Markdown formatting action to the current selection (writer-friendly
   * formatting for people who don't know the syntax — see the toolbar + ⌘B/⌘I/⌘K). */
  format(action: FormatAction): void {
    const view = this.requireView()
    switch (action) {
      case 'bold':
        this.wrapInline(view, '**')
        break
      case 'italic':
        this.wrapInline(view, '_')
        break
      case 'strike':
        this.wrapInline(view, '~~')
        break
      case 'code':
        this.wrapInline(view, '`')
        break
      case 'link':
        this.insertLink(view)
        break
      case 'h1':
        this.linePrefix(view, '# ', /^#{1,6}\s+/)
        break
      case 'h2':
        this.linePrefix(view, '## ', /^#{1,6}\s+/)
        break
      case 'quote':
        this.linePrefix(view, '> ')
        break
      case 'bullet':
        this.linePrefix(view, '- ')
        break
      case 'ordered':
        this.linePrefix(view, '1. ')
        break
    }
    view.focus()
  }

  /** Wrap (or unwrap) each selection with an inline marker (`**`, `_`, …). A
   * collapsed selection inserts the pair and drops the caret between them. */
  private wrapInline(view: EditorView, marker: string): void {
    const { state } = view
    const m = marker.length
    view.dispatch(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to)
        const before = state.sliceDoc(Math.max(0, range.from - m), range.from)
        const after = state.sliceDoc(range.to, Math.min(state.doc.length, range.to + m))
        // Already wrapped just outside the selection → unwrap.
        if (before === marker && after === marker) {
          return {
            changes: [
              { from: range.from - m, to: range.from },
              { from: range.to, to: range.to + m }
            ],
            range: EditorSelection.range(range.from - m, range.to - m)
          }
        }
        // Selection itself includes the markers → strip them.
        if (text.length >= 2 * m && text.startsWith(marker) && text.endsWith(marker)) {
          const inner = text.slice(m, text.length - m)
          return {
            changes: { from: range.from, to: range.to, insert: inner },
            range: EditorSelection.range(range.from, range.from + inner.length)
          }
        }
        return {
          changes: { from: range.from, to: range.to, insert: marker + text + marker },
          range: EditorSelection.range(range.from + m, range.to + m)
        }
      })
    )
  }

  /** Toggle a line prefix (`# `, `- `, `> `, `1. `) on every line the selection
   * touches. `strip` (headings) removes a competing prefix before adding. */
  private linePrefix(view: EditorView, prefix: string, strip?: RegExp): void {
    const { state } = view
    const changes: { from: number; to?: number; insert?: string }[] = []
    const done = new Set<number>()
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from).number
      const last = state.doc.lineAt(range.to).number
      for (let n = first; n <= last; n++) {
        if (done.has(n)) continue
        done.add(n)
        const line = state.doc.line(n)
        if (line.text.startsWith(prefix)) {
          changes.push({ from: line.from, to: line.from + prefix.length, insert: '' })
        } else {
          const existing = strip ? line.text.match(strip) : null
          const removeLen = existing ? existing[0].length : 0
          changes.push({ from: line.from, to: line.from + removeLen, insert: prefix })
        }
      }
    }
    view.dispatch({ changes })
  }

  /** Insert a `[text](url)` link around the selection and select the `url` part. */
  private insertLink(view: EditorView): void {
    const { state } = view
    view.dispatch(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to) || 'text'
        const insert = `[${text}](url)`
        const urlFrom = range.from + 1 + text.length + 2
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.range(urlFrom, urlFrom + 3)
        }
      })
    )
  }

  dispose(): void {
    this.cmVimOff?.()
    this.cmVimOff = null
    this.changeCbs.clear()
    this.vimModeCbs.clear()
    this.view?.destroy()
    this.view = null
  }

  /** (Re)bind the Vim mode-change listener to the current CM instance and push
   * the current mode. Safe to call repeatedly — it detaches the previous one. */
  private syncVimListener(): void {
    this.cmVimOff?.()
    this.cmVimOff = null
    const view = this.view
    if (!view) return
    if (!this.vimEnabled) {
      this.emitVimMode('')
      return
    }
    // getCM's typings don't describe the CM5-compat event bus; treat it loosely.
    const cm = getCM(view) as unknown as {
      on(e: string, fn: (ev: { mode?: string }) => void): void
      off(e: string, fn: (ev: { mode?: string }) => void): void
    } | null
    if (!cm) return
    const handler = (ev: { mode?: string }): void =>
      this.emitVimMode(ev?.mode ?? 'normal')
    cm.on('vim-mode-change', handler)
    this.cmVimOff = () => cm.off('vim-mode-change', handler)
    this.emitVimMode('normal')
  }

  /** Reflect the mode onto the editor DOM (for the mode-coloured cursor) and
   * notify subscribers (the status-bar chip). */
  private emitVimMode(mode: string): void {
    const dom = this.view?.dom
    if (dom) {
      if (mode) dom.setAttribute('data-vim-mode', mode)
      else dom.removeAttribute('data-vim-mode')
    }
    this.vimModeCbs.forEach((cb) => cb(mode))
  }

  // --- internals ---

  private buildState(text: string): EditorState {
    return EditorState.create({
      doc: text,
      extensions: [
        // Vim keys (+ line numbers) must sit first so the keymap wins when active.
        this.vimCompartment.of(this.vimBundle()),
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
        // Writer-friendly formatting shortcuts (sit first so they win). They
        // insert the Markdown so writers needn't know the syntax.
        keymap.of([
          { key: 'Mod-b', run: () => (this.format('bold'), true) },
          { key: 'Mod-i', run: () => (this.format('italic'), true) },
          { key: 'Mod-k', run: () => (this.format('link'), true) }
        ]),
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
  // Line-number gutter (only present in Vim mode) — quiet, mono, no chrome so it
  // doesn't fight the prose.
  '.cm-gutters': {
    backgroundColor: 'transparent',
    color: 'var(--fg-4)',
    border: 'none'
  },
  '.cm-lineNumbers .cm-gutterElement': {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-xs)',
    padding: '0 0.5rem 0 0.75rem',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
    color: 'var(--fg-2)'
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
  // Base tooltip (diagnostics/lint hover, hover previews) — themed to the design
  // popup tokens so the diagnostic pop-out is readable on any theme.
  '.cm-tooltip': {
    background: 'var(--popup-bg)',
    border: '1px solid var(--popup-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--fg)',
    boxShadow: 'var(--shadow-popup)'
  },
  '.cm-tooltip.cm-tooltip-lint': { padding: '0' },
  '.cm-diagnostic': {
    color: 'var(--fg)',
    padding: 'var(--space-2) var(--space-3)',
    borderLeftWidth: '3px'
  },
  '.cm-diagnostic-error': { borderLeftColor: 'var(--danger)' },
  '.cm-diagnostic-warning': { borderLeftColor: 'var(--warning)' },
  '.cm-diagnostic-info': { borderLeftColor: 'var(--accent)' },
  '.cm-tooltip .cm-completionInfo': {
    background: 'var(--popup-bg)',
    border: '1px solid var(--popup-border)',
    color: 'var(--fg)'
  },
  // Autocomplete popup (@-mentions) — floats on the design's popup tokens so it
  // matches the command palette and the View menu (Phase 8).
  '.cm-tooltip.cm-tooltip-autocomplete': {
    background: 'var(--popup-bg)',
    border: '1px solid var(--popup-border)',
    borderRadius: 'var(--radius-md)',
    color: 'var(--fg)',
    padding: 'var(--space-2)',
    boxShadow: 'var(--shadow-popup)'
  },
  '.cm-tooltip-autocomplete > ul': {
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-base)'
  },
  '.cm-tooltip-autocomplete > ul > li': {
    padding: 'var(--space-2) var(--space-3)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--fg)'
  },
  '.cm-tooltip-autocomplete > ul > li[aria-selected]': {
    background: 'var(--popup-active)',
    color: 'var(--fg)'
  },
  '.cm-completionLabel': { color: 'inherit' },
  '.cm-completionDetail': { color: 'var(--fg-3)', fontStyle: 'italic' },
  'li[aria-selected] .cm-completionDetail': { color: 'var(--accent)' },
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
