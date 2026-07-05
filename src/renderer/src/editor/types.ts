/**
 * Editor-seam types. These are intentionally editor-agnostic (no CodeMirror
 * imports) so the same shapes flow to a future AnalysisService and, later, an
 * LSP adapter. Offsets are character indices into the document.
 */

export type Offset = number

export interface Range {
  from: Offset
  to: Offset
}

export type DiagnosticSeverity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  from: Offset
  to: Offset
  severity: DiagnosticSeverity
  message: string
  /** Which provider produced this (for filtering later). */
  source?: string
}

export interface Completion {
  label: string
  /** Text actually inserted; defaults to `label`. */
  apply?: string
  /** Short right-aligned hint in the popup. */
  detail?: string
  /** Category, used for icons/grouping (e.g. "character"). */
  type?: string
}

export interface CompletionContext {
  /** Full document text. */
  text: string
  /** Cursor offset. */
  offset: Offset
}

export type CompletionSource = (
  ctx: CompletionContext
) => Completion[] | Promise<Completion[]> | null

export interface CursorPosition {
  offset: Offset
  /** 1-based line. */
  line: number
  /** 1-based column. */
  column: number
}

export interface EditorDoc {
  /** Identifier for the open document (path/URI). */
  uri: string
  text: string
}
