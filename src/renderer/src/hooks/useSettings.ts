import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectMeta, ThemeDef } from '@shared/types'
import { resolveTheme, tokenProp } from '../lib/theme'

/** Accent options from the Writer Design System (data-accent values). */
export const ACCENTS = ['ink', 'sage', 'clay', 'plum', 'gold', 'slate']

/** The subset of persisted app-settings this hook hydrates from on launch. */
export interface SettingsHydrate {
  theme?: string
  accent?: string
  focusMode?: boolean
  userThemes?: ThemeDef[]
  vim?: boolean
  vimWrapMotion?: boolean
}

export interface SettingsApi {
  // Appearance (persisted globally in app-settings).
  theme: string
  accent: string
  focusMode: boolean
  userThemes: ThemeDef[]
  /** User themes + the open project's themes, for the picker. */
  availableThemes: ThemeDef[]
  // Editor prefs (seeded per-project from project.json; toggles aren't persisted).
  vim: boolean
  vimWrapMotion: boolean
  diagnostics: boolean
  autosave: boolean

  // Mutators that also persist the choice globally.
  changeTheme: (next: string) => void
  setAccentTo: (next: string) => void
  cycleAccent: () => void
  toggleFocus: () => void
  toggleVim: () => void
  toggleVimWrapMotion: () => void
  // Editor toggles — not persisted globally (they follow the project's config).
  toggleDiagnostics: () => void
  toggleAutosave: () => void

  /** Seed from the persisted global settings on first launch. */
  hydrate: (s: SettingsHydrate) => void
  /** Apply an opened project's defaults (theme + editor prefs) for the session. */
  applyProjectConfig: (config: ProjectMeta['config']) => void
}

/**
 * Owns the app's appearance + editor preferences: the React state, the
 * persistence to `app-settings` (via `window.api.updateSettings`), and the
 * effect that projects theme/accent/focus onto `<html>` as the design system's
 * `data-*` attributes. App composes this instead of carrying eight `useState`s
 * plus their setters and the `<html>` apply effect.
 *
 * `projectThemes` are the open project's custom themes; they merge under the
 * user's themes to form `availableThemes` and let a custom theme id resolve.
 */
export function useSettings(projectThemes: ThemeDef[]): SettingsApi {
  const [theme, setTheme] = useState('auto')
  const [accent, setAccent] = useState('ink')
  const [focusMode, setFocusMode] = useState(false)
  const [userThemes, setUserThemes] = useState<ThemeDef[]>([])
  const [vim, setVim] = useState(false)
  // Vim j/k move by display line (gj/gk) — better for wrapped prose. Default on.
  const [vimWrapMotion, setVimWrapMotion] = useState(true)
  const [diagnostics, setDiagnostics] = useState(false)
  const [autosave, setAutosave] = useState(false)

  const availableThemes = useMemo<ThemeDef[]>(
    () => [...userThemes, ...projectThemes],
    [userThemes, projectThemes]
  )

  // Custom-theme token props currently set inline on <html>, so we can clear them
  // when switching themes (Phase 8).
  const appliedThemeTokens = useRef<string[]>([])

  // Appearance → <html> data-* attributes (the design system's theme/accent/
  // focus swaps). 'auto' resolves against the OS and follows live OS changes.
  useEffect(() => {
    const root = document.documentElement
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const { dataTheme, tokens } = resolveTheme(theme, availableThemes, mq.matches)
      root.dataset.theme = dataTheme
      // Clear the previous custom theme's inline props, then apply this one's.
      for (const prop of appliedThemeTokens.current) root.style.removeProperty(prop)
      appliedThemeTokens.current = Object.entries(tokens).map(([k, v]) => {
        const prop = tokenProp(k)
        root.style.setProperty(prop, v)
        return prop
      })
    }
    applyTheme()
    root.dataset.accent = accent
    if (focusMode) root.dataset.focus = ''
    else delete root.dataset.focus
    // Only 'auto' needs to follow live OS changes.
    if (theme === 'auto') {
      mq.addEventListener('change', applyTheme)
      return () => mq.removeEventListener('change', applyTheme)
    }
  }, [theme, accent, focusMode, availableThemes])

  const changeTheme = useCallback((next: string) => {
    setTheme(next)
    void window.api.updateSettings({ theme: next })
  }, [])
  const setAccentTo = useCallback((next: string) => {
    setAccent(next)
    void window.api.updateSettings({ accent: next })
  }, [])
  const cycleAccent = useCallback(() => {
    setAccent((prev) => {
      const next = ACCENTS[(ACCENTS.indexOf(prev) + 1) % ACCENTS.length]
      void window.api.updateSettings({ accent: next })
      return next
    })
  }, [])
  const toggleFocus = useCallback(() => {
    setFocusMode((prev) => {
      const next = !prev
      void window.api.updateSettings({ focusMode: next })
      return next
    })
  }, [])
  const toggleVim = useCallback(() => {
    setVim((prev) => {
      const next = !prev
      void window.api.updateSettings({ vim: next })
      return next
    })
  }, [])
  const toggleVimWrapMotion = useCallback(() => {
    setVimWrapMotion((prev) => {
      const next = !prev
      void window.api.updateSettings({ vimWrapMotion: next })
      return next
    })
  }, [])
  const toggleDiagnostics = useCallback(() => setDiagnostics((v) => !v), [])
  const toggleAutosave = useCallback(() => setAutosave((v) => !v), [])

  const hydrate = useCallback((s: SettingsHydrate) => {
    if (s.theme) setTheme(s.theme)
    if (s.accent) setAccent(s.accent)
    if (s.focusMode) setFocusMode(s.focusMode)
    if (s.userThemes) setUserThemes(s.userThemes)
    if (s.vim) setVim(s.vim)
    if (s.vimWrapMotion !== undefined) setVimWrapMotion(s.vimWrapMotion)
  }, [])

  const applyProjectConfig = useCallback((config: ProjectMeta['config']) => {
    setDiagnostics(config.editor?.diagnostics ?? false)
    setAutosave(config.editor?.autosave ?? false)
    // A project can ship a default look (project.json `theme`). Applied for the
    // session without persisting to the global setting — the picker still wins.
    if (config.theme) setTheme(config.theme)
  }, [])

  return {
    theme,
    accent,
    focusMode,
    userThemes,
    availableThemes,
    vim,
    vimWrapMotion,
    diagnostics,
    autosave,
    changeTheme,
    setAccentTo,
    cycleAccent,
    toggleFocus,
    toggleVim,
    toggleVimWrapMotion,
    toggleDiagnostics,
    toggleAutosave,
    hydrate,
    applyProjectConfig
  }
}
