import type { AppSettings } from '../shared/types'

/**
 * The renderer↔main trust boundary for `settings.json`. Pure (no Electron) so
 * it's unit-testable.
 *
 * Some keys are hand-edited only and drive privileged behaviour in main:
 * `grammar.lsp.command` is spawned as a process and `grammar.url` receives the
 * manuscript text. If the renderer could write them, a compromised renderer
 * would escape its sandbox — so main drops them from any renderer patch.
 */
const MAIN_ONLY_KEYS = ['grammar', 'userThemes'] as const

/** Normalize an untrusted renderer patch: non-objects become `{}` and
 * main-only keys are removed. */
export function rendererSettingsPatch(patch: unknown): Partial<AppSettings> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) return {}
  const safe: Record<string, unknown> = { ...patch }
  for (const key of MAIN_ONLY_KEYS) delete safe[key]
  return safe as Partial<AppSettings>
}

/** Strip the grammar secrets before settings reach the renderer — the premium
 * API key lives only in main (Phase 10). */
export function redactSettings(settings: AppSettings): AppSettings {
  if (!settings.grammar || (!settings.grammar.apiKey && !settings.grammar.username)) {
    return settings
  }
  const { apiKey: _k, username: _u, ...safe } = settings.grammar
  return { ...settings, grammar: safe }
}
