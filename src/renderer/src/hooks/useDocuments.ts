import { useCallback, useMemo, useRef, useState } from 'react'
import type { EditorDoc } from '../editor/types'
import { isImageFile, isInsideDir, posixDir, projectRelative } from '../lib/paths'

/** A line/column (optionally a range end) to scroll to and highlight. */
export type Reveal = { line: number; column: number; endColumn?: number }

/** One open document: its last-saved baseline and its live buffer. Kept in a ref
 * (not state) so per-keystroke edits don't re-render App; switching tabs restores
 * the live buffer, so unsaved edits are never lost (M13). */
export type OpenBuffer = { saved: string; current: string }

export interface UseDocumentsOptions {
  /** The open project's root, for resolving image + asset paths (null = none). */
  projectRoot: string | null
  /** Surface a transient message (errors, empty-state hints). */
  setNotice: (msg: string | null) => void
  /** Called after a successful save — the disk-based panels re-read then. */
  onAfterSave: () => void
}

export interface DocumentsApi {
  // --- open-tab model ---
  openPaths: string[]
  activePath: string | null
  activeLoadText: string
  dirtyPaths: Set<string>
  closingTab: string | null
  /** True when the active tab has unsaved edits. */
  dirty: boolean

  // --- derived views of the active tab ---
  /** The doc handed to the editor (null for images / no selection). */
  doc: EditorDoc | null
  /** A writer-asset:// URL when the active file is an image, else null. */
  activeImageUrl: string | null
  /** The active file's project-relative folder (for `![](src)` resolution). */
  assetDir: string

  // --- navigation + reveal ---
  navState: { back: boolean; forward: boolean }
  recentFiles: string[]
  revealTarget: (Reveal & { nonce: number }) | null

  // --- actions ---
  switchTo: (path: string) => void
  openFile: (path: string, reveal?: Reveal) => void
  closeTab: (path: string) => void
  resolveClosing: (action: 'save' | 'discard') => Promise<void>
  cancelClosing: () => void
  saveTab: (path: string) => Promise<boolean>
  goBack: () => void
  goForward: () => void
  fireReveal: (reveal: Reveal) => void
  /** Write the live buffer for the active tab + update its dirty flag. */
  updateActiveBuffer: (text: string) => void
  /** The live text of a tab (its buffer), if open. */
  currentText: (path: string) => string | undefined
  /** Replace a tab's saved+live buffer from disk (e.g. after an external edit). */
  reloadBuffer: (path: string, text: string) => void
  /** Repoint open tabs after a file/folder rename or move. */
  remapOpenDocs: (from: string, to: string) => void
  /** Close tabs for a deleted file/folder. */
  closeDocsUnder: (path: string) => void
  /** Drop all open tabs + buffers (on project open). */
  reset: () => void
}

/**
 * The app's open-document model (M13): the tab list, per-tab live buffers, the
 * active tab, dirty tracking, save/close flows, back/forward history, and the
 * editor reveal signal. Extracted from App so this core lives in one owner.
 *
 * The live buffers sit in a ref (not state) so per-keystroke edits never
 * re-render — `activeLoadText` only changes on a tab switch, when the editor
 * genuinely needs reloading. Cross-cutting glue that isn't the document model
 * (comments live-text, alias-rename detection, autosave) stays in App and drives
 * this through the returned actions.
 */
export function useDocuments(options: UseDocumentsOptions): DocumentsApi {
  const { projectRoot, setNotice, onAfterSave } = options

  const [openPaths, setOpenPaths] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  // The text to load into the editor for the active tab — set only on switch, so
  // the editor doesn't reload on every keystroke (the live buffer is in docsRef).
  const [activeLoadText, setActiveLoadText] = useState('')
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set())
  const [closingTab, setClosingTab] = useState<string | null>(null)
  const [revealTarget, setRevealTarget] = useState<(Reveal & { nonce: number }) | null>(
    null
  )

  const docsRef = useRef(new Map<string, OpenBuffer>())
  // Navigation history (back/forward through visited files) + button enabled state.
  const navStack = useRef<string[]>([])
  const navIndex = useRef(-1)
  const navigating = useRef(false)
  const [navState, setNavState] = useState({ back: false, forward: false })
  // Session recency for Quick Open (files).
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const revealNonce = useRef(0)

  // The doc handed to the editor — keyed on the active tab only, so typing (which
  // mutates the buffer in the ref) never re-loads the editor. Switching tabs
  // recomputes and loads that tab's live buffer.
  const doc = useMemo<EditorDoc | null>(
    () =>
      activePath && !isImageFile(activePath)
        ? { uri: activePath, text: activeLoadText }
        : null,
    [activePath, activeLoadText]
  )

  // A writer-asset:// URL when the active file is an image (shown in ImageView).
  const activeImageUrl = useMemo(() => {
    if (!projectRoot || !activePath || !isImageFile(activePath)) return null
    const rel = projectRelative(projectRoot, activePath)
    return `writer-asset://asset/${rel.split('/').map(encodeURIComponent).join('/')}`
  }, [projectRoot, activePath])

  const dirty = activePath ? dirtyPaths.has(activePath) : false

  // The active file's project-relative folder — resolves `![](src)` image paths
  // and lets us insert a file-relative path when importing.
  const assetDir = useMemo(
    () =>
      projectRoot && activePath ? posixDir(projectRelative(projectRoot, activePath)) : '',
    [projectRoot, activePath]
  )

  const fireReveal = useCallback((reveal: Reveal) => {
    revealNonce.current += 1
    setRevealTarget({ ...reveal, nonce: revealNonce.current })
  }, [])

  const markDirty = useCallback((path: string, isDirty: boolean) => {
    setDirtyPaths((prev) => {
      if (prev.has(path) === isDirty) return prev
      const next = new Set(prev)
      if (isDirty) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  /** Make a tab active and load its live buffer into the editor. */
  const switchTo = useCallback((path: string) => {
    setActivePath(path)
    setActiveLoadText(docsRef.current.get(path)?.current ?? '')
    // Recency (MRU, for Quick Open) + back/forward history. A back/forward jump
    // sets `navigating` so the target isn't re-pushed onto the stack.
    setRecentFiles((prev) => [path, ...prev.filter((p) => p !== path)].slice(0, 20))
    if (navigating.current) {
      navigating.current = false
    } else if (navStack.current[navIndex.current] !== path) {
      navStack.current.splice(navIndex.current + 1)
      navStack.current.push(path)
      navIndex.current = navStack.current.length - 1
    }
    setNavState({
      back: navIndex.current > 0,
      forward: navIndex.current < navStack.current.length - 1
    })
  }, [])

  const clearActive = useCallback(() => {
    setActivePath(null)
    setActiveLoadText('')
  }, [])

  /** Open a file in a tab (or switch to it if already open); optionally reveal a
   * line. Switching never loses edits — each tab keeps its own live buffer. */
  const openFile = useCallback(
    (path: string, reveal?: Reveal) => {
      if (docsRef.current.has(path)) {
        switchTo(path)
        if (reveal) fireReveal(reveal)
        return
      }
      // Images open in the read-only viewer, not the text editor — no text read.
      if (isImageFile(path)) {
        docsRef.current.set(path, { saved: '', current: '' })
        setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
        switchTo(path)
        return
      }
      void (async () => {
        const result = await window.api.readFile(path)
        if (!result.ok) {
          setNotice(`Couldn't open file: ${result.error}`)
          return
        }
        docsRef.current.set(path, { saved: result.text, current: result.text })
        setOpenPaths((prev) => (prev.includes(path) ? prev : [...prev, path]))
        switchTo(path)
        setNotice(null)
        if (reveal) fireReveal(reveal)
      })()
    },
    [fireReveal, switchTo, setNotice]
  )

  const goBack = useCallback(() => {
    if (navIndex.current <= 0) return
    navIndex.current--
    navigating.current = true
    openFile(navStack.current[navIndex.current])
  }, [openFile])
  const goForward = useCallback(() => {
    if (navIndex.current >= navStack.current.length - 1) return
    navIndex.current++
    navigating.current = true
    openFile(navStack.current[navIndex.current])
  }, [openFile])

  const updateActiveBuffer = useCallback(
    (text: string) => {
      if (!activePath) return
      const buffer = docsRef.current.get(activePath)
      if (!buffer) return
      buffer.current = text
      markDirty(activePath, text !== buffer.saved)
    },
    [activePath, markDirty]
  )

  const currentText = useCallback(
    (path: string) => docsRef.current.get(path)?.current,
    []
  )

  const reloadBuffer = useCallback(
    (path: string, text: string) => {
      if (!docsRef.current.has(path)) return
      docsRef.current.set(path, { saved: text, current: text })
      markDirty(path, false)
      if (path === activePath) setActiveLoadText(text)
    },
    [activePath, markDirty]
  )

  const saveTab = useCallback(
    async (path: string): Promise<boolean> => {
      if (isImageFile(path)) return true // read-only; never write over the binary
      const buffer = docsRef.current.get(path)
      if (!buffer) return true
      const result = await window.api.writeFile(path, buffer.current)
      if (!result.ok) {
        setNotice(`Couldn't save: ${result.error}`)
        return false
      }
      buffer.saved = buffer.current
      markDirty(path, false)
      // The Inspector + Companion read from disk; a save is when their view can
      // change.
      onAfterSave()
      return true
    },
    [markDirty, setNotice, onAfterSave]
  )

  const doCloseTab = (path: string) => {
    const idx = openPaths.indexOf(path)
    const next = openPaths.filter((p) => p !== path)
    docsRef.current.delete(path)
    setOpenPaths(next)
    markDirty(path, false)
    if (activePath === path) {
      if (next.length) switchTo(next[Math.min(idx, next.length - 1)])
      else clearActive()
    }
  }

  const closeTab = (path: string) => {
    if (dirtyPaths.has(path)) {
      setClosingTab(path)
      return
    }
    doCloseTab(path)
  }

  const resolveClosing = async (action: 'save' | 'discard') => {
    const path = closingTab
    if (!path) return
    if (action === 'save' && !(await saveTab(path))) {
      setClosingTab(null)
      return
    }
    setClosingTab(null)
    doCloseTab(path)
  }

  const cancelClosing = () => setClosingTab(null)

  // Keep open tabs pointing at a renamed/moved file or folder (content unchanged).
  const remapOpenDocs = (from: string, to: string) => {
    const remap = (p: string) =>
      p === from ? to : isInsideDir(p, from) ? to + p.slice(from.length) : p
    const map = docsRef.current
    let changed = false
    for (const [p, buffer] of [...map.entries()]) {
      const np = remap(p)
      if (np !== p) {
        map.delete(p)
        map.set(np, buffer)
        changed = true
      }
    }
    if (!changed) return
    setOpenPaths((prev) => prev.map(remap))
    setActivePath((prev) => (prev ? remap(prev) : prev))
    setDirtyPaths((prev) => new Set([...prev].map(remap)))
  }

  // Close tabs for a deleted file/folder.
  const closeDocsUnder = (path: string) => {
    const affected = [...docsRef.current.keys()].filter(
      (p) => p === path || isInsideDir(p, path)
    )
    if (!affected.length) return
    affected.forEach((p) => docsRef.current.delete(p))
    const next = openPaths.filter((p) => !affected.includes(p))
    setOpenPaths(next)
    setDirtyPaths((prev) => new Set([...prev].filter((p) => !affected.includes(p))))
    if (activePath && affected.includes(activePath)) {
      if (next.length) switchTo(next[next.length - 1])
      else clearActive()
    }
  }

  const reset = useCallback(() => {
    docsRef.current.clear()
    setOpenPaths([])
    setActivePath(null)
    setActiveLoadText('')
    setDirtyPaths(new Set())
  }, [])

  return {
    openPaths,
    activePath,
    activeLoadText,
    dirtyPaths,
    closingTab,
    dirty,
    doc,
    activeImageUrl,
    assetDir,
    navState,
    recentFiles,
    revealTarget,
    switchTo,
    openFile,
    closeTab,
    resolveClosing,
    cancelClosing,
    saveTab,
    goBack,
    goForward,
    fireReveal,
    updateActiveBuffer,
    currentText,
    reloadBuffer,
    remapOpenDocs,
    closeDocsUnder,
    reset
  }
}
