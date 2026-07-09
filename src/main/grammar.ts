import type { GrammarMatch, GrammarSettings } from '../shared/types'
import { readSettings } from './settings'

/**
 * External grammar/style checking (Phase 10, M26) — the main-process side of the
 * `AnalysisService` `languagetool` provider. Calls a LanguageTool server's
 * `/v2/check` endpoint and maps its `matches[]` to the editor's offset-based
 * `GrammarMatch` shape.
 *
 * Lives in main so the network call — and any premium API key — never touches
 * the renderer (SPEC → Phase 10). Off unless the user opts in via `settings.json`
 * (`grammar.enabled` + a `url`); returns `[]` for anything unconfigured or on any
 * error, so a misconfigured checker can never break the editor.
 */

// LanguageTool `rule.issueType` → the editor's three severities. Spelling and
// grammar mistakes warn; stylistic/typographic nits are informational.
function severityFor(issueType: string | undefined): GrammarMatch['severity'] {
  switch (issueType) {
    case 'misspelling':
    case 'grammar':
      return 'warning'
    default:
      return 'info'
  }
}

type LtMatch = {
  message?: string
  offset?: number
  length?: number
  replacements?: { value?: string }[]
  rule?: { id?: string; issueType?: string; category?: { id?: string; name?: string } }
}

/** POST prose to LanguageTool and return its hits (empty on disable/error). */
export async function checkGrammar(text: string): Promise<GrammarMatch[]> {
  if (!text.trim()) return []
  const cfg: GrammarSettings = (await readSettings()).grammar ?? {}
  if (!cfg.enabled || !cfg.url) return []

  const body = new URLSearchParams({
    text,
    language: cfg.language || 'auto'
  })
  if (cfg.motherTongue) body.set('motherTongue', cfg.motherTongue)
  // Premium cloud auth (optional) — these live only here in main.
  if (cfg.username && cfg.apiKey) {
    body.set('username', cfg.username)
    body.set('apiKey', cfg.apiKey)
  }

  const endpoint = `${cfg.url.replace(/\/+$/, '')}/v2/check`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal
    })
    if (!res.ok) return []
    const data = (await res.json()) as { matches?: LtMatch[] }
    return (data.matches ?? []).flatMap((m): GrammarMatch[] => {
      if (typeof m.offset !== 'number' || typeof m.length !== 'number') return []
      return [
        {
          offset: m.offset,
          length: m.length,
          message: m.message ?? 'Grammar issue',
          severity: severityFor(m.rule?.issueType),
          ruleId: m.rule?.id,
          category: m.rule?.category?.name,
          replacements: (m.replacements ?? [])
            .map((r) => r.value)
            .filter((v): v is string => !!v)
            .slice(0, 5)
        }
      ]
    })
  } catch {
    // Network error, bad JSON, timeout, LanguageTool down — degrade silently.
    return []
  } finally {
    clearTimeout(timeout)
  }
}
