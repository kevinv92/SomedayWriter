import {
  Compartment,
  EditorSelection,
  EditorState,
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension
} from '@codemirror/state'
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  keymap,
  drawSelection,
  lineNumbers,
  hoverTooltip,
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
import { vim, getCM, Vim } from '@replit/codemirror-vim'

import type { EditorAdapter, FormatAction } from './editor-adapter'
import { tidyTableBlock } from '../lib/table'
import { posixResolve } from '../lib/paths'
import type {
  CompletionSource,
  CursorPosition,
  Diagnostic,
  EditorDoc,
  Range
} from './types'

// ⌘/Ctrl-hover "clickable mention" underline (Phase 5 affordance). A single-range
// decoration driven by the adapter's mousemove handler.
const setLinkMark = StateEffect.define<{ from: number; to: number } | null>()
const linkHoverField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (e.is(setLinkMark)) {
        deco = e.value
          ? Decoration.set([
              Decoration.mark({ class: 'cm-link-hover' }).range(e.value.from, e.value.to)
            ])
          : Decoration.none
      }
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})

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
  // ⌘/Ctrl-hover mention feedback: resolver → range, and the current linked range.
  private mentionResolver:
    ((lineText: string, column: number) => { from: number; to: number } | null) | null =
    null
  private linkRange: { from: number; to: number } | null = null

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

  /** Put DOM focus on the editor (without moving the caret). */
  focus(): void {
    this.view?.focus()
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

  /** Register the resolver that maps a line + column to a mention's char range,
   * used to underline it as clickable while ⌘/Ctrl is held. */
  setMentionResolver(
    resolver:
      ((lineText: string, column: number) => { from: number; to: number } | null) | null
  ): void {
    this.mentionResolver = resolver
  }

  /** Clear any ⌘/Ctrl-hover link underline. */
  private clearLink(view: EditorView): void {
    view.dom.classList.remove('cm-linkable')
    if (this.linkRange) {
      this.linkRange = null
      view.dispatch({ effects: setLinkMark.of(null) })
    }
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

  /** Make Vim `j`/`k` (and ↓/↑) move by display line (gj/gk) rather than logical
   * line — better for wrapped prose. Vim maps are global, so this affects the
   * editor whenever Vim is on. */
  setVimWrapMotion(enabled: boolean): void {
    const pairs: [string, string][] = [
      ['j', 'gj'],
      ['k', 'gk'],
      ['<Down>', 'gj'],
      ['<Up>', 'gk']
    ]
    for (const [lhs, rhs] of pairs) {
      for (const mode of ['normal', 'visual'] as const) {
        if (enabled) Vim.map(lhs, rhs, mode)
        else Vim.unmap(lhs, mode)
      }
    }
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
      case 'comment':
        this.insertComment(view)
        break
      case 'suggest-insert':
        this.wrapPair(view, '{++', '++}')
        break
      case 'suggest-delete':
        this.wrapPair(view, '{--', '--}')
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

  /** Accept or reject the CriticMarkup change under the cursor (M25). Insertion:
   * accept keeps the text, reject drops it; deletion is the inverse; substitution
   * `{~~old~>new~~}` keeps new/old; a highlight unwraps; a comment is stripped. */
  resolveChange(accept: boolean): void {
    const view = this.requireView()
    const { state } = view
    const pos = state.selection.main.head
    const line = state.doc.lineAt(pos)
    const re = /\{==.*?==\}|\{>>.*?<<\}|\{\+\+.*?\+\+\}|\{--.*?--\}|\{~~.*?~~\}/g
    let m: RegExpExecArray | null
    while ((m = re.exec(line.text)) !== null) {
      const from = line.from + m.index
      const to = from + m[0].length
      if (pos < from || pos > to) continue
      const s = m[0]
      const inner = s.slice(3, -3)
      let replacement = inner
      if (s.startsWith('{++')) replacement = accept ? inner : ''
      else if (s.startsWith('{--')) replacement = accept ? '' : inner
      else if (s.startsWith('{~~')) {
        const arrow = inner.indexOf('~>')
        replacement =
          arrow >= 0 ? (accept ? inner.slice(arrow + 2) : inner.slice(0, arrow)) : inner
      } else if (s.startsWith('{>>')) replacement = ''
      // {== highlight ==} keeps its inner text (unwrap) for both accept/reject.
      view.dispatch({ changes: { from, to, insert: replacement } })
      view.focus()
      return
    }
  }

  /** Tidy the Markdown table around the cursor: pad cells so columns align. */
  formatTable(): void {
    const view = this.requireView()
    const { doc } = view.state
    const cur = doc.lineAt(view.state.selection.main.head).number
    const hasPipe = (n: number): boolean => doc.line(n).text.includes('|')
    if (!hasPipe(cur)) return
    let start = cur
    let end = cur
    while (start > 1 && hasPipe(start - 1)) start--
    while (end < doc.lines && hasPipe(end + 1)) end++
    const from = doc.line(start).from
    const to = doc.line(end).to
    const block = doc.sliceString(from, to)
    const tidy = tidyTableBlock(block)
    if (!tidy || tidy === block) return
    view.dispatch({ changes: { from, to, insert: tidy } })
    view.focus()
  }

  /** The current file's project-relative directory, so `![](src)` image paths
   * (relative to the file) resolve to loadable `writer-asset://` URLs. */
  setAssetDir(dir: string): void {
    this.view?.dispatch({ effects: setAssetDirEffect.of(dir) })
  }

  /** Insert a Markdown image at the cursor. */
  insertImage(alt: string, src: string): void {
    const view = this.requireView()
    const md = `![${alt}](${src})`
    const pos = view.state.selection.main.head
    view.dispatch({
      changes: { from: pos, insert: md },
      selection: { anchor: pos + md.length }
    })
    view.focus()
  }

  /** Wrap the selection with a distinct open/close pair; caret between them when
   * nothing is selected. */
  private wrapPair(view: EditorView, open: string, close: string): void {
    const { state } = view
    view.dispatch(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to)
        return {
          changes: { from: range.from, to: range.to, insert: open + text + close },
          range: EditorSelection.range(
            range.from + open.length,
            range.from + open.length + text.length
          )
        }
      })
    )
  }

  /** Attach a CriticMarkup comment (M23): `{==span==}{>>…<<}` around a selection,
   * or a point comment `{>>…<<}`; the caret lands inside the comment. */
  private insertComment(view: EditorView): void {
    const { state } = view
    view.dispatch(
      state.changeByRange((range) => {
        const text = state.sliceDoc(range.from, range.to)
        const prefix = text ? `{==${text}==}{>>` : '{>>'
        const insert = `${prefix}<<}`
        const caret = range.from + prefix.length
        return {
          changes: { from: range.from, to: range.to, insert },
          range: EditorSelection.range(caret, caret)
        }
      })
    )
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
        criticPlugin,
        criticField,
        criticHover,
        threadMarkerPlugin,
        frontmatterPlugin,
        assetDirField,
        imageField,
        mentionField,
        colorField,
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
        linkHoverField,
        EditorView.domEventHandlers({
          mousedown: (event, view) => {
            if (!this.goToDefinition || !(event.metaKey || event.ctrlKey)) return false
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos == null) return false
            const line = view.state.doc.lineAt(pos)
            event.preventDefault()
            this.goToDefinition({ lineText: line.text, column: pos - line.from + 1 })
            return true
          },
          // ⌘/Ctrl-hover a mention → show it as clickable (underline + pointer).
          mousemove: (event, view) => {
            if (!(event.metaKey || event.ctrlKey) || !this.mentionResolver) {
              this.clearLink(view)
              return false
            }
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
            if (pos == null) return false
            const line = view.state.doc.lineAt(pos)
            const r = this.mentionResolver(line.text, pos - line.from + 1)
            if (!r) {
              this.clearLink(view)
              return false
            }
            const abs = { from: line.from + r.from, to: line.from + r.to }
            if (this.linkRange?.from === abs.from && this.linkRange?.to === abs.to)
              return false
            this.linkRange = abs
            view.dom.classList.add('cm-linkable')
            view.dispatch({ effects: setLinkMark.of(abs) })
            return false
          },
          keyup: (event, view) => {
            if (!event.metaKey && !event.ctrlKey) this.clearLink(view)
            return false
          },
          mouseleave: (_event, view) => {
            this.clearLink(view)
            return false
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
// Scan the whole doc (not MatchDecorator, which is line-scoped) so a `%% note %%`
// that wraps across lines still styles.
const noteMark = Decoration.mark({ class: 'cm-note' })
function noteDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const text = view.state.doc.toString()
  const re = /%%[\s\S]*?%%/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    builder.add(m.index, m.index + m[0].length, noteMark)
  }
  return builder.finish()
}

const notesPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = noteDecorations(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged) this.decorations = noteDecorations(update.view)
    }
  },
  { decorations: (v) => v.decorations }
)

// Inline image preview. `assetDirField` holds the current file's project-relative
// directory (set by the adapter on file load) so `![alt](src)` paths — which are
// relative to the file — resolve to a `writer-asset://` URL the sandbox can load.
const setAssetDirEffect = StateEffect.define<string>()
const assetDirField = StateField.define<string>({
  create: () => '',
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setAssetDirEffect)) return e.value
    return value
  }
})

const IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string
  ) {
    super()
  }
  eq(other: ImageWidget): boolean {
    return other.url === this.url && other.alt === this.alt
  }
  toDOM(): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-image'
    const img = document.createElement('img')
    img.src = this.url
    img.alt = this.alt
    img.loading = 'lazy'
    wrap.appendChild(img)
    return wrap
  }
  ignoreEvent(): boolean {
    return false
  }
}

function buildImageDecos(state: EditorState): DecorationSet {
  const assetDir = state.field(assetDirField, false) ?? ''
  const builder = new RangeSetBuilder<Decoration>()
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.includes('![')) continue
    IMAGE_RE.lastIndex = 0
    let m: RegExpExecArray | null
    let last: { url: string; alt: string } | null = null
    while ((m = IMAGE_RE.exec(line.text)) !== null) {
      const src = m[2]
      // Only local project paths — CSP blocks http(s)/data image sources here.
      if (/^[a-z][a-z0-9+.-]*:/i.test(src) || src.startsWith('//')) continue
      const rel = posixResolve(assetDir, decodeURIComponent(src))
      const url = `writer-asset://asset/${rel.split('/').map(encodeURIComponent).join('/')}`
      last = { url, alt: m[1] }
    }
    if (last) {
      builder.add(
        line.to,
        line.to,
        Decoration.widget({
          widget: new ImageWidget(last.url, last.alt),
          block: true,
          side: 1
        })
      )
    }
  }
  return builder.finish()
}

// Block widgets must come from a state field (a view plugin's decorations can't
// carry block widgets), recomputed on edits or when the file's asset dir changes.
const imageField = StateField.define<DecorationSet>({
  create: (state) => buildImageDecos(state),
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setAssetDirEffect))) {
      return buildImageDecos(tr.state)
    }
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

// Soften `@{surface}` mentions for reading: hide the braces and tint the surface
// at rest so prose reads cleanly ("Irene Adler", not "@{Irene Adler}"); reveal the
// raw syntax when the cursor enters the token, so it stays fully editable.
const mentionMark = Decoration.mark({ class: 'cm-mention' })
const hideBrace = Decoration.replace({})
const MENTION_TOKEN_RE = /@\{([^}\n]+)\}/g

function buildMentionDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const sel = state.selection.main
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.includes('@{')) continue
    MENTION_TOKEN_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = MENTION_TOKEN_RE.exec(line.text)) !== null) {
      const from = line.from + m.index
      const to = from + m[0].length
      const innerFrom = from + 2 // after `@{`
      const innerTo = to - 1 // before `}`
      // Cursor within (or touching) the token → show raw for editing.
      if (sel.from <= to && sel.to >= from) {
        builder.add(innerFrom, innerTo, mentionMark)
      } else {
        builder.add(from, innerFrom, hideBrace)
        builder.add(innerFrom, innerTo, mentionMark)
        builder.add(innerTo, to, hideBrace)
      }
    }
  }
  return builder.finish()
}

const mentionField = StateField.define<DecorationSet>({
  create: (state) => buildMentionDecos(state),
  update(deco, tr) {
    // Recompute on edits and on cursor moves (to reveal/hide around the caret).
    if (tr.docChanged || tr.selection) return buildMentionDecos(tr.state)
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

// Soften wrapper CriticMarkup for reading, the same way as mentions: hide the
// `{++`/`++}`, `{--`/`--}`, `{==`/`==}` delimiters at rest and keep only the styled
// inner text, revealing the raw syntax when the cursor enters the token. Every
// wrapper has a 3-char opener and 3-char closer, so the geometry is uniform.
const criticMarks: Record<string, Decoration> = {
  '{==': Decoration.mark({ class: 'cm-critic-highlight' }),
  '{++': Decoration.mark({ class: 'cm-critic-insert' }),
  '{--': Decoration.mark({ class: 'cm-critic-delete' })
}
const CRITIC_WRAP_RE = /\{==.*?==\}|\{\+\+.*?\+\+\}|\{--.*?--\}/g

function buildCriticDecos(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  const sel = state.selection.main
  const doc = state.doc
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n)
    if (!line.text.includes('{')) continue
    CRITIC_WRAP_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = CRITIC_WRAP_RE.exec(line.text)) !== null) {
      const mark = criticMarks[m[0].slice(0, 3)]
      if (!mark) continue
      const from = line.from + m.index
      const to = from + m[0].length
      const innerFrom = from + 3 // after `{++`
      const innerTo = to - 3 // before `++}`
      // Cursor within (or touching) the token → show raw for editing.
      if (sel.from <= to && sel.to >= from) {
        if (innerTo > innerFrom) builder.add(innerFrom, innerTo, mark)
      } else {
        builder.add(from, innerFrom, hideBrace)
        if (innerTo > innerFrom) builder.add(innerFrom, innerTo, mark)
        builder.add(innerTo, to, hideBrace)
      }
    }
  }
  return builder.finish()
}

const criticField = StateField.define<DecorationSet>({
  create: (state) => buildCriticDecos(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildCriticDecos(tr.state)
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

// Inline colour swatches for hex colours in a file's frontmatter (e.g. a thread
// or entity `color:`). Renders a small native colour input right after the hex;
// picking a colour rewrites the literal in place. Scoped to the leading `---`
// block so it never touches hex-looking text in prose.
const HEX_COLOR_RE = /#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g

/** Expand `#rgb` → `#rrggbb` so a native `<input type=color>` accepts it. */
function normalizeHex(hex: string): string {
  if (hex.length === 4) {
    return '#' + [hex[1], hex[2], hex[3]].map((c) => c + c).join('')
  }
  return hex.toLowerCase()
}

class ColorSwatchWidget extends WidgetType {
  constructor(
    readonly hex: string,
    readonly from: number,
    readonly to: number
  ) {
    super()
  }
  eq(other: ColorSwatchWidget): boolean {
    return other.hex === this.hex && other.from === this.from
  }
  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input')
    input.type = 'color'
    input.className = 'cm-color-swatch'
    input.value = normalizeHex(this.hex)
    input.title = 'Pick colour'
    // Don't let the click move the editor caret / start a selection.
    input.addEventListener('mousedown', (e) => e.stopPropagation())
    input.addEventListener('input', () => {
      view.dispatch({ changes: { from: this.from, to: this.to, insert: input.value } })
    })
    return input
  }
  ignoreEvent(): boolean {
    return true
  }
}

/** [start, end) offsets of the frontmatter body, or null when there's no leading
 * `---` fence. */
function frontmatterRange(state: EditorState): [number, number] | null {
  const doc = state.doc
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return null
  for (let n = 2; n <= doc.lines; n++) {
    if (doc.line(n).text.trim() === '---') return [doc.line(2).from, doc.line(n).from]
  }
  return null
}

function buildColorDecos(state: EditorState): DecorationSet {
  const range = frontmatterRange(state)
  const builder = new RangeSetBuilder<Decoration>()
  if (!range) return builder.finish()
  const [start, end] = range
  const text = state.doc.sliceString(start, end)
  HEX_COLOR_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = HEX_COLOR_RE.exec(text)) !== null) {
    const from = start + m.index
    const to = from + m[0].length
    builder.add(
      to,
      to,
      Decoration.widget({ widget: new ColorSwatchWidget(m[0], from, to), side: 1 })
    )
  }
  return builder.finish()
}

const colorField = StateField.define<DecorationSet>({
  create: (state) => buildColorDecos(state),
  update(deco, tr) {
    if (tr.docChanged) return buildColorDecos(tr.state)
    return deco.map(tr.changes)
  },
  provide: (f) => EditorView.decorations.from(f)
})

/**
 * Editorial marks (Phase 9, M23) — CriticMarkup, in plain text so it survives
 * anywhere and is stripped on export. Split by form:
 *   • `{~~old~>new~~}` and `{>>comment<<}` keep their syntax visible (styled
 *     marks only) — the delimiters carry meaning that can't collapse to one
 *     readable span, so they stay here in the always-on MatchDecorator.
 *   • `{++insert++}`, `{--delete--}`, `{==highlight==}` are wrapper forms whose
 *     inner text reads as prose, so `criticField` (below) hides the delimiters at
 *     rest and reveals them on caret entry, mirroring `@{}` mentions.
 */
const CRITIC_CLASS: Record<string, string> = {
  '{>>': 'cm-critic-comment',
  '{~~': 'cm-critic-subst'
}

const criticMatcher = new MatchDecorator({
  regexp: /\{>>.*?<<\}|\{~~.*?~~\}/g,
  decoration: (match) =>
    Decoration.mark({ class: CRITIC_CLASS[match[0].slice(0, 3)] ?? 'cm-critic-comment' })
})

const criticPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = criticMatcher.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = criticMatcher.updateDeco(update, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * Inline thread markers (Phase 9, M25b) — `<!-- thread:x -->…<!-- /thread -->`
 * scope part of a scene to a thread. De-emphasised like HTML comments; the story
 * index reads them so the scene joins that thread (see `parseInlineThreadTags`).
 */
const threadMarkerMatcher = new MatchDecorator({
  regexp: /<!--\s*\/?thread(?::[\w-]+)?\s*-->/g,
  decoration: Decoration.mark({ class: 'cm-thread-marker' })
})

const threadMarkerPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = threadMarkerMatcher.createDeco(view)
    }
    update(update: ViewUpdate) {
      this.decorations = threadMarkerMatcher.updateDeco(update, this.decorations)
    }
  },
  { decorations: (v) => v.decorations }
)

/** Hover a `{>>comment<<}` to read the comment on its own, without the syntax. */
const criticHover = hoverTooltip((view, pos) => {
  const line = view.state.doc.lineAt(pos)
  const re = /\{>>(.*?)<<\}/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line.text)) !== null) {
    const from = line.from + m.index
    const to = from + m[0].length
    if (pos >= from && pos <= to) {
      const text = m[1].trim()
      return {
        pos: from,
        end: to,
        above: true,
        create: () => {
          const dom = document.createElement('div')
          dom.className = 'cm-comment-tooltip'
          dom.textContent = text || '(empty comment)'
          return { dom }
        }
      }
    }
  }
  return null
})

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
    // A very subtle "sheet" tint so the reading column (line length) is visible
    // against the pane. Derived from the text colour → works in every theme.
    backgroundColor: 'color-mix(in oklch, var(--fg) 3%, transparent)',
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
  '.cm-comment-tooltip': {
    maxWidth: '22rem',
    padding: 'var(--space-3) var(--space-4)',
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-sm)',
    lineHeight: 'var(--leading-snug)',
    color: 'var(--fg)'
  },
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
  // Editorial marks (M23). Highlight span: a warm marker; comment: dimmed accent.
  '.cm-critic-highlight': {
    backgroundColor: 'var(--highlight)',
    borderRadius: '2px'
  },
  '.cm-critic-comment': {
    color: 'var(--accent)',
    backgroundColor: 'var(--accent-soft)',
    borderRadius: '3px',
    padding: '0 2px',
    fontSize: '0.9em'
  },
  // Tracked changes (M25): suggested insert / delete / substitute.
  '.cm-critic-insert': {
    color: 'var(--success)',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in oklch, var(--success) 60%, transparent)'
  },
  '.cm-critic-delete': {
    color: 'var(--danger)',
    textDecoration: 'line-through',
    textDecorationColor: 'color-mix(in oklch, var(--danger) 60%, transparent)'
  },
  '.cm-critic-subst': {
    color: 'var(--warning)',
    backgroundColor: 'color-mix(in oklch, var(--warning) 12%, transparent)',
    borderRadius: '3px'
  },
  // ⌘/Ctrl-hover a mention → it reads as a clickable link.
  '.cm-link-hover': {
    color: 'var(--accent)',
    textDecoration: 'underline',
    textDecorationColor: 'var(--accent)',
    cursor: 'pointer'
  },
  '&.cm-linkable .cm-content': { cursor: 'pointer' },
  // Resting-state mention: braces hidden, surface gently tinted so prose reads
  // clean while the link stays marked.
  '.cm-mention': {
    color: 'color-mix(in oklch, var(--accent) 70%, var(--fg))'
  },
  // Inline colour swatch after a frontmatter hex colour — a small native picker.
  '.cm-color-swatch': {
    width: '0.9em',
    height: '0.9em',
    verticalAlign: 'middle',
    marginLeft: '0.35em',
    padding: '0',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    cursor: 'pointer',
    background: 'none',
    WebkitAppearance: 'none',
    appearance: 'none'
  },
  '.cm-color-swatch::-webkit-color-swatch-wrapper': { padding: '0' },
  '.cm-color-swatch::-webkit-color-swatch': { border: 'none', borderRadius: '2px' },
  // Inline thread markers (M25b): a quiet structural tag, not prose.
  '.cm-thread-marker': {
    color: 'var(--accent)',
    opacity: '0.7',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85em'
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
