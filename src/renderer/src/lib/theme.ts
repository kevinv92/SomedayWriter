import type { ThemeDef } from '@shared/types'

/** How a theme id resolves for application: which built-in `data-theme` to set as
 * the base, and any token overrides to apply as inline custom properties. */
export type ResolvedTheme = {
  dataTheme: 'light' | 'dark'
  tokens: Record<string, string>
}

/** The always-present built-in theme options (before user/project themes). */
export const BUILTIN_THEME_OPTIONS: { id: string; name: string }[] = [
  { id: 'auto', name: 'Match system' },
  { id: 'light', name: 'Warm paper (light)' },
  { id: 'dark', name: 'Warm dusk (dark)' }
]

/**
 * Resolve a theme id (Phase 8) to a base `data-theme` + token overrides.
 * `auto`/`light`/`dark` are built-ins (no overrides); any other id is looked up
 * in `themes` (user + project) and applied over its `base`. Unknown ids fall back
 * to the system preference so a stale/removed theme never leaves a blank UI.
 */
export function resolveTheme(
  id: string,
  themes: ThemeDef[],
  prefersDark: boolean
): ResolvedTheme {
  const auto: 'light' | 'dark' = prefersDark ? 'dark' : 'light'
  if (id === 'light' || id === 'dark') return { dataTheme: id, tokens: {} }
  if (id === 'auto') return { dataTheme: auto, tokens: {} }
  const theme = themes.find((t) => t.id === id)
  if (!theme) return { dataTheme: auto, tokens: {} }
  return { dataTheme: theme.base ?? 'dark', tokens: theme.tokens }
}

/** Normalise a token key to a CSS custom-property name (`bg` → `--bg`). */
export function tokenProp(key: string): string {
  return key.startsWith('--') ? key : `--${key}`
}
