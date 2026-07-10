import { useCallback, useState } from 'react'

/**
 * The right-hand overlay/side panels and reference overlays, each a simple
 * open/closed toggle. Consolidated into one hook so App doesn't carry a dozen
 * `useState` booleans + repetitive `setXOpen((v) => !v)` toggles — the menubar,
 * the rail, the command palette, and keyboard shortcuts all drive them through
 * one `toggle`/`set` API.
 *
 * Not included here (they aren't plain boolean panels): the explorer sidebar
 * (`sidebarHidden`), the command palette / quick-open (`quickInput`), and the
 * menubar dropdowns (`menuOpen`) — those stay in App.
 */
export const PANEL_KEYS = [
  'search',
  'refs',
  'inspector',
  'companion',
  'threads',
  'braid',
  'comments',
  'frontmatter',
  'health',
  'help'
] as const

export type PanelKey = (typeof PANEL_KEYS)[number]

type PanelState = Record<PanelKey, boolean>

const ALL_CLOSED: PanelState = {
  search: false,
  refs: false,
  inspector: false,
  companion: false,
  threads: false,
  braid: false,
  comments: false,
  frontmatter: false,
  health: false,
  help: false
}

export interface PanelsApi {
  /** Current open/closed state per panel. */
  open: PanelState
  /** Flip a panel open↔closed. */
  toggle: (key: PanelKey) => void
  /** Force a panel to a specific state (no-op if already there). */
  set: (key: PanelKey, value: boolean) => void
}

export function usePanels(): PanelsApi {
  const [open, setOpen] = useState<PanelState>(ALL_CLOSED)

  const toggle = useCallback((key: PanelKey) => {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }))
  }, [])

  const set = useCallback((key: PanelKey, value: boolean) => {
    setOpen((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }))
  }, [])

  return { open, toggle, set }
}
