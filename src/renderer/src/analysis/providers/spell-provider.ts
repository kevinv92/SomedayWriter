import type { AnalysisDoc, AnalysisProvider, Diagnostic } from '../types'
import { spellDiagnostics } from '../spell'

/**
 * Diagnostics provider: flags common misspellings and repeated words. Emits on
 * `didChange`; the facade decides whether to show the squiggles (off by default).
 */
export function createSpellProvider(): AnalysisProvider {
  let emit: ((uri: string, diags: Diagnostic[]) => void) | null = null
  return {
    id: 'spell',
    capabilities: ['diagnostics'],
    onDiagnostics(cb) {
      emit = cb
    },
    didChange(doc: AnalysisDoc) {
      emit?.(doc.uri, spellDiagnostics(doc.text))
    }
  }
}
