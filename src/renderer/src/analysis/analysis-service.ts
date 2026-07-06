import type {
  Completion,
  CompletionContext,
  CompletionSource,
  Diagnostic
} from '../editor/types'
import type { AnalysisDoc, AnalysisProvider } from './types'

/**
 * The single facade the editor talks to (SPEC → Analysis). It holds a registry
 * of providers, fans document changes out to them, aggregates their diagnostics,
 * and merges their completions. Debounce, suppression, and the diagnostics
 * on/off gate live here — once, not per provider.
 *
 * Diagnostics are **push** (providers emit; the facade forwards, or suppresses
 * when off) and **off by default**. Completions are **pull** (the editor asks)
 * and are never gated by the diagnostics toggle.
 */
const DEBOUNCE_MS = 300

export class AnalysisService {
  private readonly providers: AnalysisProvider[] = []
  private readonly byProvider = new Map<string, Diagnostic[]>()
  private readonly diagListeners = new Set<(uri: string, diags: Diagnostic[]) => void>()
  private doc: AnalysisDoc | null = null
  private enabled = false
  private timer: ReturnType<typeof setTimeout> | null = null

  register(provider: AnalysisProvider): void {
    this.providers.push(provider)
    provider.onDiagnostics?.((uri, diags) => {
      this.byProvider.set(provider.id, diags)
      this.emit(uri)
    })
    if (this.doc) provider.didOpen?.(this.doc)
  }

  /** Turn the whole diagnostics channel on/off (the UI toggle + config default).
   * Off suppresses every provider's squiggles; completions are unaffected. */
  setDiagnosticsEnabled(on: boolean): void {
    if (this.enabled === on) return
    this.enabled = on
    if (!this.doc) return
    if (on) this.runDiagnostics()
    else this.emit(this.doc.uri) // clears squiggles
  }

  /** Notify the facade the open document changed (or was first loaded). */
  update(doc: AnalysisDoc): void {
    const changedFile = this.doc?.uri !== doc.uri
    this.doc = doc
    if (changedFile) {
      this.byProvider.clear()
      this.providers.forEach((p) => p.didOpen?.(doc))
    }
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => this.runDiagnostics(), DEBOUNCE_MS)
  }

  onDiagnostics(cb: (uri: string, diags: Diagnostic[]) => void): () => void {
    this.diagListeners.add(cb)
    return () => this.diagListeners.delete(cb)
  }

  /** Merged completion source handed to the editor. Concatenates every
   * completion provider's results and de-dupes by label. */
  readonly completionSource: CompletionSource = async (ctx: CompletionContext) => {
    const active = this.providers.filter(
      (p) => p.complete && p.capabilities.includes('completion')
    )
    const lists = await Promise.all(
      active.map((p) => Promise.resolve(p.complete?.(ctx) ?? []).catch(() => []))
    )
    const merged: Completion[] = []
    const seen = new Set<string>()
    for (const list of lists) {
      for (const item of list ?? []) {
        if (seen.has(item.label)) continue
        seen.add(item.label)
        merged.push(item)
      }
    }
    return merged
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer)
    this.providers.forEach((p) => p.dispose?.())
    this.providers.length = 0
    this.diagListeners.clear()
    this.byProvider.clear()
    this.doc = null
  }

  // Recompute diagnostics for the current doc. When disabled we skip provider
  // work and just emit an empty set (SPEC: the facade suppresses when off).
  private runDiagnostics(): void {
    if (!this.doc) return
    if (!this.enabled) {
      this.emit(this.doc.uri)
      return
    }
    this.providers
      .filter((p) => p.capabilities.includes('diagnostics'))
      .forEach((p) => p.didChange?.(this.doc as AnalysisDoc))
  }

  private emit(uri: string): void {
    const merged = this.enabled ? [...this.byProvider.values()].flat() : []
    this.diagListeners.forEach((listener) => listener(uri, merged))
  }
}
