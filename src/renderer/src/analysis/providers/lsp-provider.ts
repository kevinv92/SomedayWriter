import type { GrammarMatch } from '@shared/types'
import type { AnalysisDoc, AnalysisProvider, Diagnostic } from '../types'

/**
 * Diagnostics provider (Phase 10, M27): a live language server. Unlike the HTTP
 * grammar provider (request/response), diagnostics here are **push** — the server
 * publishes them asynchronously, main forwards over the `onGrammarDiagnostics`
 * channel, and this provider emits them to the facade. On `didChange` it just
 * syncs the document to main (which is a no-op unless the LSP engine is
 * configured), so it's inert until the user points `grammar.lsp.command` at a
 * server. Registered behind the same facade as spell + the HTTP checker.
 */
function toDiagnostic(m: GrammarMatch): Diagnostic {
  return {
    from: m.offset,
    to: m.offset + m.length,
    severity: m.severity,
    message: m.message,
    source: 'lsp'
  }
}

export function createLspProvider(): AnalysisProvider {
  let off: (() => void) | null = null
  return {
    id: 'lsp',
    capabilities: ['diagnostics'],
    onDiagnostics(cb) {
      // Subscribe once to main's push channel; each publish replaces the set.
      off = window.api.onGrammarDiagnostics((uri, matches) => {
        cb(uri, matches.map(toDiagnostic))
      })
    },
    // Only sync on change — didChange fires only while diagnostics are enabled,
    // so the server never spawns when grammar is off.
    didChange(doc: AnalysisDoc) {
      void window.api.lspSync(doc.uri, doc.text)
    },
    didClose(uri: string) {
      void window.api.lspClose(uri)
    },
    dispose() {
      off?.()
      off = null
    }
  }
}
