import type { Completion, CompletionContext, Diagnostic } from '../editor/types'

/**
 * The pluggable-analysis layer (SPEC → Analysis). Providers implement this
 * interface and register with the `AnalysisService` facade; nothing here imports
 * CodeMirror. Diagnostic/Completion/CompletionContext are reused from the editor
 * seam (they're deliberately editor-agnostic), so the same shapes flow editor →
 * facade → provider and, later, to an LSP adapter.
 */

export type { Completion, CompletionContext, Diagnostic }

/** The document a provider analyses. Offset-based to match the editor seam — a
 * refinement of the SPEC's LSP `Position` sketch, since the editor works in
 * offsets (cf. decision #20). */
export type AnalysisDoc = { uri: string; text: string }

export type Capability = 'diagnostics' | 'completion' | 'hover'

export interface AnalysisProvider {
  id: string
  capabilities: Capability[]

  // Document lifecycle (mirrors LSP didOpen/didChange/didClose).
  didOpen?(doc: AnalysisDoc): void
  didChange?(doc: AnalysisDoc): void
  didClose?(uri: string): void

  /** Push: register a callback the provider calls when it has new diagnostics. */
  onDiagnostics?(cb: (uri: string, diags: Diagnostic[]) => void): void

  /** Pull: the editor asks for completions at the cursor. */
  complete?(ctx: CompletionContext): Completion[] | Promise<Completion[]> | null

  dispose?(): void
}
