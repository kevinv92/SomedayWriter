import { useCallback, useState, type MouseEvent as ReactMouseEvent } from 'react'

export interface LayoutApi {
  /** Explorer sidebar width in px (drag-resizable, persisted). */
  sidebarWidth: number
  /** Right-hand panel width in px, shared by all panels (drag-resizable). */
  panelWidth: number
  /** Whether the explorer sidebar is collapsed. */
  sidebarHidden: boolean
  toggleSidebar: () => void
  startSidebarResize: (e: ReactMouseEvent) => void
  startPanelResize: (e: ReactMouseEvent) => void
  /** Seed widths from persisted settings on first launch. */
  hydrate: (s: { sidebarWidth?: number; panelWidth?: number }) => void
}

/**
 * Chrome layout: the explorer + panel widths (drag-resizable and persisted to
 * app-settings) and the explorer's collapsed state. Extracted from App so the
 * resize plumbing lives on its own.
 */
export function useLayout(): LayoutApi {
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [panelWidth, setPanelWidth] = useState(320)
  const [sidebarHidden, setSidebarHidden] = useState(false)

  const toggleSidebar = useCallback(() => setSidebarHidden((v) => !v), [])

  // Drag the divider to resize the sidebar (clamped to a readable range).
  const startSidebarResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = sidebarWidth
      let latest = startWidth
      const onMove = (ev: MouseEvent) => {
        latest = Math.min(Math.max(startWidth + ev.clientX - startX, 160), 480)
        setSidebarWidth(latest)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        void window.api.updateSettings({ sidebarWidth: latest })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sidebarWidth]
  )

  // Drag the right-panel divider to resize the panels (they share one width).
  // The panels are on the right, so dragging left (smaller clientX) widens them.
  const startPanelResize = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startWidth = panelWidth
      let latest = startWidth
      const onMove = (ev: MouseEvent) => {
        latest = Math.min(Math.max(startWidth - (ev.clientX - startX), 240), 640)
        setPanelWidth(latest)
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
        void window.api.updateSettings({ panelWidth: latest })
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [panelWidth]
  )

  const hydrate = useCallback((s: { sidebarWidth?: number; panelWidth?: number }) => {
    if (s.sidebarWidth) setSidebarWidth(s.sidebarWidth)
    if (s.panelWidth) setPanelWidth(s.panelWidth)
  }, [])

  return {
    sidebarWidth,
    panelWidth,
    sidebarHidden,
    toggleSidebar,
    startSidebarResize,
    startPanelResize,
    hydrate
  }
}
