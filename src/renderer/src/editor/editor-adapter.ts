import type {
  CompletionSource,
  CursorPosition,
  Diagnostic,
  EditorDoc,
  Range
} from './types'

/**
 * The editor seam. Nothing outside an implementation of this interface knows
 * which editor library is in use. The app is committed to CodeMirror 6
 * (see DECISIONS.md), but talks to it only through here so the choice stays
 * swappable.
 *
 * Markdown text is the canonical representation in and out — any editor that
 * implements this contract feeds and returns Markdown.
 *
 * NOTE: this refines the illustrative sketch in spec/architecture.md. Completions are a
 * registered *source* (pull) rather than a pushed list, matching how editors
 * and the future AnalysisService actually work; `onChange` yields the new text.
 */
/** Writer-friendly Markdown formatting actions (toolbar + ⌘B/⌘I/⌘K). Inline
 * wraps: bold/italic/strike/code + link. Line prefixes: headings/quote/lists. */
export type FormatAction =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'link'
  | 'comment'
  | 'suggest-insert'
  | 'suggest-delete'
  | 'h1'
  | 'h2'
  | 'quote'
  | 'bullet'
  | 'ordered'

export interface EditorAdapter {
  /** Attach the editor to a host element. Call once. */
  mount(parent: HTMLElement): void

  /** Replace the open document. */
  loadDoc(doc: EditorDoc): void

  getText(): string

  /** Subscribe to document changes; returns an unsubscribe fn. */
  onChange(cb: (text: string) => void): () => void

  /**
   * Render this exact set of diagnostics (squiggles). Pushed by whatever
   * computes them; the editor just displays. Pass `[]` to clear. Off by
   * default — the caller decides when to push (diagnostics are opt-in).
   */
  setDiagnostics(diagnostics: Diagnostic[]): void

  /** Register (or clear) the completion/intellisense source. */
  setCompletionSource(source: CompletionSource | null): void

  /** Scroll to and select a range (used by references / visualiser). */
  focusRange(range: Range): void

  /** Scroll to a 1-based line and place the cursor at `column`. If `endColumn`
   * is given, select the span `[column, endColumn)` so the match is highlighted
   * (jump-to-reference); otherwise just place the caret (jump-to-search-match). */
  focusLine(line: number, column?: number, endColumn?: number): void

  /** Put DOM focus on the editor without moving the caret. */
  focus(): void

  /** Force genuine editable focus (blur→focus) so contentEditable typing lands
   * after a jump, not just after a click. See the adapter impl for the why. */
  forceRefocus(): void

  /** Whether the editor currently holds DOM focus. */
  hasFocus(): boolean

  getCursor(): CursorPosition

  /** The cursor line's full text plus the 1-based cursor column — enough to
   * resolve a mention under the cursor (go-to-definition) without leaking
   * editor internals. */
  getCursorContext(): { lineText: string; column: number }

  /** Register (or clear) a handler invoked when the user requests
   * go-to-definition on a mention via the editor (Cmd/Ctrl+click). It receives
   * the clicked line's text and 1-based column; the caller resolves the entity
   * and opens its profile (StoryIndex lives outside the editor seam). */
  setGoToDefinition(
    handler: ((ctx: { lineText: string; column: number }) => void) | null
  ): void

  /** Register a resolver mapping (lineText, 1-based column) → the mention's char
   * range, used to underline it as clickable while ⌘/Ctrl is held. Pass null to
   * clear. */
  setMentionResolver(
    resolver:
      ((lineText: string, column: number) => { from: number; to: number } | null) | null
  ): void

  setVimMode(enabled: boolean): void

  /** Vim `j`/`k` move by display line (gj/gk) instead of logical line. */
  setVimWrapMotion(enabled: boolean): void

  /** Subscribe to Vim mode changes: 'normal' | 'insert' | 'visual' | 'replace',
   * or '' when Vim is off. Returns an unsubscribe fn. */
  onVimModeChange(cb: (mode: string) => void): () => void

  /** Apply a Markdown formatting action to the current selection. */
  format(action: FormatAction): void

  /** Accept (true) or reject (false) the tracked change under the cursor. */
  resolveChange(accept: boolean): void

  /** Tidy the Markdown table around the cursor: align its columns. */
  formatTable(): void

  /** Set the active file's project-relative dir (resolves image paths). */
  setAssetDir(dir: string): void

  /** Insert a Markdown image `![alt](src)` at the cursor. */
  insertImage(alt: string, src: string): void

  /** Replace a character range (frontmatter editor write-back). */
  replaceRange(from: number, to: number, insert: string): void

  dispose(): void
}
