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
 * (see SPEC.md → Decision history), but talks to it only through here so the
 * choice stays swappable.
 *
 * Markdown text is the canonical representation in and out — any editor that
 * implements this contract feeds and returns Markdown.
 *
 * NOTE: this refines the illustrative sketch in SPEC.md. Completions are a
 * registered *source* (pull) rather than a pushed list, matching how editors
 * and the future AnalysisService actually work; `onChange` yields the new text.
 */
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

  /** Scroll to and place the cursor at a 1-based line (and optional 1-based
   * column). Used to jump to a project-search match. */
  focusLine(line: number, column?: number): void

  getCursor(): CursorPosition

  setVimMode(enabled: boolean): void

  dispose(): void
}
