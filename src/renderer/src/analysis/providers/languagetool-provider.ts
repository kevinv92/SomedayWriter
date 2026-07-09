import type { GrammarMatch } from '@shared/types'
import type { AnalysisDoc, AnalysisProvider, Diagnostic } from '../types'

/**
 * Diagnostics provider (Phase 10, M26): external grammar/style checking via
 * LanguageTool. The network call + any API key live in main (`analysis:grammar`
 * IPC); this side just requests a check on `didChange` and maps the offset-based
 * `GrammarMatch`es to the editor's `Diagnostic` shape. Behind the same facade as
 * the built-in spell provider, so the diagnostics toggle governs it too, and it
 * stays inert (main returns `[]`) until the user configures + enables it.
 */
function toDiagnostic(m: GrammarMatch): Diagnostic {
  return {
    from: m.offset,
    to: m.offset + m.length,
    severity: m.severity,
    message: m.message,
    source: 'languagetool'
  }
}

export function createLanguageToolProvider(): AnalysisProvider {
  let emit: ((uri: string, diags: Diagnostic[]) => void) | null = null
  // Monotonic request id: checks are async + debounced, so a later change (or a
  // file switch) must be able to discard an earlier, now-stale response.
  let seq = 0
  return {
    id: 'languagetool',
    capabilities: ['diagnostics'],
    onDiagnostics(cb) {
      emit = cb
    },
    didOpen() {
      // A new document invalidates any in-flight request for the previous one.
      seq++
    },
    didChange(doc: AnalysisDoc) {
      const reqId = ++seq
      const { uri } = doc
      void window.api.checkGrammar(doc.text).then((matches) => {
        if (reqId !== seq) return // superseded by a newer change/open — drop it
        emit?.(uri, matches.map(toDiagnostic))
      })
    }
  }
}
