import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { Editor, type EditorHandle, type EditorStatus } from './components/Editor'
import { FileTree } from './components/FileTree'
import { ConfirmModal, PromptModal, UnsavedChangesModal } from './components/Modal'
import { BraidView } from './components/BraidView'
import { CompanionPanel } from './components/CompanionPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { ProjectSearch } from './components/ProjectSearch'
import { ReferencesPanel } from './components/ReferencesPanel'
import { ThreadsPanel } from './components/ThreadsPanel'
import { QuickInput, type QuickCommand, type QuickFile } from './components/QuickInput'
import { AnalysisService } from './analysis/analysis-service'
import { createEntityProvider } from './analysis/providers/entity-provider'
import { createSpellProvider } from './analysis/providers/spell-provider'
import type { EditorDoc } from './editor/types'
import type {
  Entity,
  OpenProjectResult,
  ProjectMeta,
  RecentProject,
  TreeNode
} from '@shared/types'
import { entityTypeMeta, resolveEntityTypes } from '@shared/entity-types'
import { basename, isInsideDir, joinPath, parentDir } from './lib/paths'
import { entityAt } from './lib/mentions'

type Reveal = { line: number; column: number; endColumn?: number }

/** One open document: its last-saved baseline and its live buffer. Kept in a ref
 * (not state) so per-keystroke edits don't re-render App; switching tabs restores
 * the live buffer, so unsaved edits are never lost (M13). */
type OpenBuffer = { saved: string; current: string }

// Resolve an editor.font value to a CSS font-family: a preset keyword, or a
// custom family string passed through as-is (an installed font).
function fontStack(font: string | undefined): string {
  if (!font || font === 'serif') {
    return 'Georgia, "Iowan Old Style", "Times New Roman", serif'
  }
  if (font === 'sans') return 'system-ui, -apple-system, "Segoe UI", sans-serif'
  if (font === 'mono') return 'ui-monospace, SFMono-Regular, Menlo, monospace'
  return font
}

type ModalState =
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'rename'; node: TreeNode }
  | { kind: 'delete'; node: TreeNode }
  | null

export default function App() {
  const [project, setProject] = useState<ProjectMeta | null>(null)
  const [recents, setRecents] = useState<RecentProject[]>([])
  const [sidebarWidth, setSidebarWidth] = useState(240)
  const [panelWidth, setPanelWidth] = useState(320)
  const [tree, setTree] = useState<TreeNode | null>(null)

  // Open tabs: the ordered paths, which is active, and which are dirty. The
  // text buffers live in `docsRef` (see OpenBuffer).
  const [openPaths, setOpenPaths] = useState<string[]>([])
  const [activePath, setActivePath] = useState<string | null>(null)
  // The text to load into the editor for the active tab — set only on switch, so
  // the editor doesn't reload on every keystroke (the live buffer is in docsRef).
  const [activeLoadText, setActiveLoadText] = useState('')
  const [dirtyPaths, setDirtyPaths] = useState<Set<string>>(new Set())
  const [closingTab, setClosingTab] = useState<string | null>(null)

  const [notice, setNotice] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [refsOpen, setRefsOpen] = useState(false)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [companionOpen, setCompanionOpen] = useState(false)
  const [threadsOpen, setThreadsOpen] = useState(false)
  const [braidOpen, setBraidOpen] = useState(false)
  // Bumped after a save / entity change so the disk-based Inspector + Companion
  // re-read the active file.
  const [inspectorRefresh, setInspectorRefresh] = useState(0)
  // Companion pins for the current project (paths); the full per-project map lives
  // in allPinsRef so persisting one project never clobbers another's.
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([])
  // Story entities (StoryIndex), for the references panel + go-to-definition.
  const [entities, setEntities] = useState<Entity[]>([])
  // null = closed; otherwise the initial query ('' = Quick Open, '>' = palette).
  const [quickInput, setQuickInput] = useState<string | null>(null)
  const [revealTarget, setRevealTarget] = useState<(Reveal & { nonce: number }) | null>(
    null
  )
  const [vim, setVim] = useState(false)
  const [diagnostics, setDiagnostics] = useState(false)
  const [autosave, setAutosave] = useState(false)
  const [status, setStatus] = useState<EditorStatus>({
    words: 0,
    cursor: { line: 1, column: 1 }
  })

  const docsRef = useRef(new Map<string, OpenBuffer>())
  const revealNonce = useRef(0)
  const didInit = useRef(false)
  // Live handle onto the editor, for palette-driven go-to-definition (reads the
  // cursor while the editor is unfocused behind the palette).
  const editorHandle = useRef<EditorHandle | null>(null)
  // The whole Companion pins map (project root → paths), loaded from settings.
  const allPinsRef = useRef<Record<string, string[]>>({})

  // The doc handed to the editor — keyed on the active tab only, so typing (which
  // mutates the buffer in the ref) never re-loads the editor. Switching tabs
  // recomputes and loads that tab's live buffer.
  const doc = useMemo<EditorDoc | null>(
    () => (activePath ? { uri: activePath, text: activeLoadText } : null),
    [activePath, activeLoadText]
  )

  const dirty = activePath ? dirtyPaths.has(activePath) : false

  // The analysis facade + its providers (Phase 4). Created once; the editor
  // talks only to this, never to a provider (SPEC seam).
  const entityProvider = useMemo(() => createEntityProvider(), [])
  const analysis = useMemo(() => {
    const service = new AnalysisService()
    service.register(entityProvider.provider)
    service.register(createSpellProvider())
    return service
  }, [entityProvider])
  useEffect(() => () => analysis.dispose(), [analysis])

  // Load story entities (characters, locations, items, …) from StoryIndex;
  // refresh after edits. Feeds the completion provider, references/
  // go-to-definition, and (via the refresh nonce) the disk-based Inspector +
  // Companion scene detection.
  const refreshEntities = useCallback(() => {
    void window.api.storyEntities().then((next) => {
      entityProvider.setEntities(next)
      setEntities(next)
    })
    setInspectorRefresh((n) => n + 1)
  }, [entityProvider])

  // Pin/unpin a Companion reference for the current project, persisting the whole
  // per-project map so other projects' pins are preserved.
  const togglePin = useCallback(
    (path: string) => {
      if (!project) return
      const current = allPinsRef.current[project.root] ?? []
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path]
      allPinsRef.current = { ...allPinsRef.current, [project.root]: next }
      setPinnedPaths(next)
      void window.api.updateSettings({ pins: allPinsRef.current })
    },
    [project]
  )

  // Flat list of the project's .md files for Quick Open (Cmd/Ctrl+P).
  const projectFiles = useMemo<QuickFile[]>(() => {
    const out: QuickFile[] = []
    const walk = (node: TreeNode) => {
      if (node.type === 'file') {
        if (node.name.endsWith('.md')) out.push({ path: node.path, name: node.name })
      } else node.children?.forEach(walk)
    }
    tree?.children?.forEach(walk)
    return out
  }, [tree])

  // Registered entity types (Phase 7, M18): built-in defaults with this project's
  // `entityTypes` merged over them. Drives type badges, frontmatter intellisense,
  // and new-file templates — one source of truth for every "what is a location?".
  const entityTypes = useMemo(() => resolveEntityTypes(project?.config), [project])

  // Icon per profile file, so the tree can badge a location vs. an item. Keyed by
  // path off the entity list (only files with a `type:` appear).
  const entityIcons = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of entities) map.set(e.path, entityTypeMeta(e.type, entityTypes).icon)
    return map
  }, [entities, entityTypes])

  const refreshTree = async () => {
    setTree(await window.api.readTree())
    refreshEntities()
  }

  // Manual "Reload from Disk": drop the main-process index cache, re-read the
  // tree + entities, and nudge the panels to refetch. For changes made outside
  // the app (another editor, a git checkout) that the app can't see.
  const forceRefresh = useCallback(async () => {
    await window.api.refreshIndex()
    setTree(await window.api.readTree())
    refreshEntities()
    setNotice('Reloaded from disk.')
  }, [refreshEntities])

  const fireReveal = useCallback((reveal: Reveal) => {
    revealNonce.current += 1
    setRevealTarget({ ...reveal, nonce: revealNonce.current })
  }, [])

  // --- tabs: open / switch / close (M13) ---

  /** Make a tab active and load its live buffer into the editor. */
  const switchTo = useCallback((path: string) => {
    setActivePath(path)
    setActiveLoadText(docsRef.current.get(path)?.current ?? '')
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
    [fireReveal, switchTo]
  )

  // Go-to-definition: resolve the entity under a cursor position (a Cmd/Ctrl+click
  // in the editor, or the palette command reading the cursor) and open its profile.
  const goToDefinition = useCallback(
    (lineText: string, column: number) => {
      const entity = entityAt(lineText, column, entities)
      if (!entity) {
        setNotice('No entity under the cursor.')
        return
      }
      setNotice(null)
      openFile(entity.path)
    },
    [entities, openFile]
  )

  const markDirty = useCallback((path: string, isDirty: boolean) => {
    setDirtyPaths((prev) => {
      if (prev.has(path) === isDirty) return prev
      const next = new Set(prev)
      if (isDirty) next.add(path)
      else next.delete(path)
      return next
    })
  }, [])

  const handleDocChange = useCallback(
    (text: string) => {
      if (!activePath) return
      const buffer = docsRef.current.get(activePath)
      if (!buffer) return
      buffer.current = text
      markDirty(activePath, text !== buffer.saved)
    },
    [activePath, markDirty]
  )

  const saveTab = useCallback(
    async (path: string): Promise<boolean> => {
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
      setInspectorRefresh((n) => n + 1)
      return true
    },
    [markDirty]
  )

  // Autosave (opt-in, M14): when on, save the active tab a beat after it goes
  // dirty. Whole-file write for now; explicit Cmd/Ctrl+S stays the default.
  useEffect(() => {
    if (!autosave || !activePath || !dirtyPaths.has(activePath)) return
    const timer = setTimeout(() => void saveTab(activePath), 1000)
    return () => clearTimeout(timer)
  }, [autosave, activePath, dirtyPaths, saveTab])

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

  // --- project open ---

  const applyOpenResult = useCallback(
    async (result: OpenProjectResult) => {
      if (!result.ok) {
        if (result.reason === 'cancelled') return
        if (result.reason === 'no-config') {
          setNotice(`No project.json in ${result.root} — not a writer-gui project yet.`)
        } else {
          setNotice(`Couldn't open project: ${result.message}`)
        }
        return
      }
      const nextTree = await window.api.readTree()
      docsRef.current.clear()
      setProject(result.project)
      setTree(nextTree)
      setOpenPaths([])
      setActivePath(null)
      setDirtyPaths(new Set())
      setNotice(null)
      setDiagnostics(result.project.config.editor?.diagnostics ?? false)
      setAutosave(result.project.config.editor?.autosave ?? false)
      setPinnedPaths(allPinsRef.current[result.project.root] ?? [])
      refreshEntities()
    },
    [refreshEntities]
  )

  const openProject = useCallback(async () => {
    await applyOpenResult(await window.api.openProject())
  }, [applyOpenResult])

  const openRecent = useCallback(
    async (path: string) => {
      await applyOpenResult(await window.api.openRecent(path))
    },
    [applyOpenResult]
  )

  // Drag the divider to resize the sidebar (clamped to a readable range).
  const startSidebarResize = useCallback(
    (e: React.MouseEvent) => {
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
    (e: React.MouseEvent) => {
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

  // On first mount: load settings, restore the sidebar width, and reopen the
  // most recent project (falling back to the welcome + recents list if it fails).
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    void (async () => {
      const settings = await window.api.getSettings()
      setRecents(settings.recentProjects)
      if (settings.sidebarWidth) setSidebarWidth(settings.sidebarWidth)
      if (settings.panelWidth) setPanelWidth(settings.panelWidth)
      allPinsRef.current = settings.pins ?? {}
      const last = settings.recentProjects[0]
      if (last) await openRecent(last.path)
    })()
  }, [openRecent])

  // --- explorer file operations (M4) ---

  async function createFileIn(dir: string, name: string) {
    const fileName = name.includes('.') ? name : `${name}.md`
    const path = joinPath(dir, fileName)
    const result = await window.api.createFile(path)
    if (!result.ok) {
      setNotice(`Couldn't create file: ${result.error}`)
      return
    }
    await refreshTree()
    if (fileName.endsWith('.md')) openFile(path)
  }

  async function createFolderIn(dir: string, name: string) {
    const result = await window.api.createFolder(joinPath(dir, name))
    if (!result.ok) {
      setNotice(`Couldn't create folder: ${result.error}`)
      return
    }
    await refreshTree()
  }

  async function renameNode(node: TreeNode, newName: string) {
    const to = joinPath(parentDir(node.path), newName)
    if (to === node.path) return
    const result = await window.api.rename(node.path, to)
    if (!result.ok) {
      setNotice(`Couldn't rename: ${result.error}`)
      return
    }
    remapOpenDocs(node.path, to)
    await refreshTree()
  }

  async function deleteNode(node: TreeNode) {
    const result = await window.api.remove(node.path)
    if (!result.ok) {
      setNotice(`Couldn't delete: ${result.error}`)
      return
    }
    closeDocsUnder(node.path)
    await refreshTree()
  }

  // --- manuscript order + move (M6) ---

  const siblingsOf = (path: string): TreeNode[] => {
    const search = (node: TreeNode): TreeNode[] | null => {
      if (!node.children) return null
      if (node.children.some((c) => c.path === path)) return node.children
      for (const child of node.children) {
        const found = search(child)
        if (found) return found
      }
      return null
    }
    return tree ? (search(tree) ?? []) : []
  }

  const renormalize = async (files: TreeNode[]) => {
    for (let i = 0; i < files.length; i++) {
      await window.api.setOrder(files[i].path, (i + 1) * 10)
    }
  }

  async function moveInto(fromPath: string, folderPath: string) {
    const to = joinPath(folderPath, basename(fromPath))
    if (to === fromPath) return
    const result = await window.api.rename(fromPath, to)
    if (!result.ok) {
      setNotice(`Couldn't move: ${result.error}`)
      return
    }
    remapOpenDocs(fromPath, to)
    await refreshTree()
  }

  async function handleDrop(draggedPath: string, target: TreeNode) {
    if (target.type === 'directory') {
      await moveInto(draggedPath, target.path)
      return
    }
    if (!target.name.endsWith('.md')) {
      await moveInto(draggedPath, parentDir(target.path))
      return
    }
    const targetParent = parentDir(target.path)
    const sibs = siblingsOf(target.path).filter(
      (n) => n.type === 'file' && n.path !== draggedPath
    )
    const ti = sibs.findIndex((n) => n.path === target.path)
    if (ti === -1) return
    const next = sibs[ti + 1]
    let a = sibs[ti].order
    let b = next?.order
    if (a == null || (next && b == null)) {
      await renormalize(sibs)
      a = (ti + 1) * 10
      b = next ? (ti + 2) * 10 : undefined
    }
    const newOrder = b != null ? (a + b) / 2 : a + 10
    const set = await window.api.setOrder(draggedPath, newOrder)
    if (!set.ok) {
      setNotice(`Couldn't reorder: ${set.error}`)
      return
    }
    if (parentDir(draggedPath) !== targetParent) {
      const to = joinPath(targetParent, basename(draggedPath))
      const moved = await window.api.rename(draggedPath, to)
      if (!moved.ok) {
        setNotice(`Couldn't move: ${moved.error}`)
        return
      }
      remapOpenDocs(draggedPath, to)
    }
    await refreshTree()
  }

  // --- keyboard shortcuts ---

  const saveRef = useRef<() => void>(() => {})
  const closeActiveRef = useRef<() => void>(() => {})
  const navRef = useRef({
    cycleTab: (_dir: 1 | -1) => {},
    jumpTab: (_n: number) => {},
    focusExplorer: () => {}
  })
  useEffect(() => {
    saveRef.current = () => {
      if (activePath) void saveTab(activePath)
    }
    closeActiveRef.current = () => {
      if (activePath) closeTab(activePath)
    }
    navRef.current = {
      cycleTab: (dir) => {
        const n = openPaths.length
        if (!n) return
        const i = openPaths.indexOf(activePath ?? '')
        switchTo(openPaths[(i + dir + n) % n])
      },
      jumpTab: (num) => {
        const path = openPaths[num - 1]
        if (path) switchTo(path)
      },
      focusExplorer: () => document.querySelector<HTMLElement>('.tree')?.focus()
    }
  })
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Tab / Ctrl+Shift+Tab cycle tabs (the cross-platform standard;
      // Cmd+Tab is the OS app switcher, so never use it here).
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        navRef.current.cycleTab(e.shiftKey ? -1 : 1)
        return
      }
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      const k = e.key.toLowerCase()
      if (k === 's' && !e.shiftKey) {
        e.preventDefault()
        saveRef.current()
      } else if (k === 'f' && e.shiftKey) {
        e.preventDefault()
        setSearchOpen((v) => !v)
      } else if (k === 'w') {
        e.preventDefault()
        closeActiveRef.current()
      } else if (k === 'p') {
        e.preventDefault()
        setQuickInput(e.shiftKey ? '>' : '')
      } else if (k === 'e' && e.shiftKey) {
        e.preventDefault()
        navRef.current.focusExplorer()
      } else if (!e.shiftKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault()
        navRef.current.jumpTab(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!project) {
    return (
      <div className="welcome">
        <h1>writer-gui</h1>
        <p>Open a folder with a project.json — or any folder to start a new project.</p>
        <button className="welcome__open" onClick={() => void openProject()}>
          Open Project…
        </button>
        {recents.length > 0 && (
          <div className="welcome__recents">
            <div className="welcome__recents-title">Recent projects</div>
            {recents.map((r) => (
              <button
                key={r.path}
                className="welcome__recent"
                title={r.path}
                onClick={() => void openRecent(r.path)}
              >
                <span className="welcome__recent-name">{r.name}</span>
                <span className="welcome__recent-path">{r.path}</span>
              </button>
            ))}
          </div>
        )}
        {notice && <p className="welcome__notice">{notice}</p>}
      </div>
    )
  }

  // Editor typography from config, applied as CSS vars on the editor pane.
  const ed = project.config.editor
  const measureVar =
    ed?.measure === 'full'
      ? 'none'
      : typeof ed?.measure === 'number'
        ? `${ed.measure}rem`
        : '46rem'
  const editorStyle = {
    '--editor-measure': measureVar,
    '--editor-font': fontStack(ed?.font),
    '--editor-font-size': ed?.fontSize ? `${ed.fontSize}px` : '16px',
    '--editor-line-height': ed?.lineHeight ? String(ed.lineHeight) : '1.7'
  } as CSSProperties

  // Command registry (SPEC → command palette). Declared once here; the palette,
  // and later menus/keybindings, draw from it.
  const commands: QuickCommand[] = [
    { id: 'open-project', title: 'Open Project…', run: () => void openProject() },
    {
      id: 'new-file',
      title: 'New File',
      run: () => tree && setModal({ kind: 'newFile', dir: tree.path })
    },
    {
      id: 'new-folder',
      title: 'New Folder',
      run: () => tree && setModal({ kind: 'newFolder', dir: tree.path })
    },
    {
      id: 'find-in-project',
      title: 'Find in Project',
      hint: '⌘⇧F',
      run: () => setSearchOpen((v) => !v)
    },
    {
      id: 'find-references',
      title: 'Find References…',
      run: () => setRefsOpen(true)
    },
    {
      id: 'go-to-definition',
      title: 'Go to Definition',
      run: () => {
        const ctx = editorHandle.current?.cursorContext()
        if (ctx) goToDefinition(ctx.lineText, ctx.column)
      }
    },
    {
      id: 'toggle-inspector',
      title: 'Toggle Inspector',
      run: () => setInspectorOpen((v) => !v)
    },
    {
      id: 'toggle-companion',
      title: 'Toggle Companion',
      run: () => setCompanionOpen((v) => !v)
    },
    {
      id: 'toggle-threads',
      title: 'Toggle Threads',
      run: () => setThreadsOpen((v) => !v)
    },
    {
      id: 'toggle-braid',
      title: 'Toggle Thread Braid',
      run: () => setBraidOpen((v) => !v)
    },
    {
      id: 'reload-from-disk',
      title: 'Reload from Disk',
      run: () => void forceRefresh()
    },
    {
      id: 'pin-to-companion',
      title: 'Pin Current File to Companion',
      run: () => {
        if (activePath) {
          togglePin(activePath)
          setCompanionOpen(true)
        }
      }
    },
    {
      id: 'toggle-vim',
      title: `Toggle Vim (${vim ? 'on' : 'off'})`,
      run: () => setVim((v) => !v)
    },
    {
      id: 'toggle-diagnostics',
      title: `Toggle Diagnostics (${diagnostics ? 'on' : 'off'})`,
      run: () => setDiagnostics((v) => !v)
    },
    {
      id: 'toggle-autosave',
      title: `Toggle Autosave (${autosave ? 'on' : 'off'})`,
      run: () => setAutosave((v) => !v)
    },
    {
      id: 'save',
      title: 'Save',
      hint: '⌘S',
      run: () => {
        if (activePath) void saveTab(activePath)
      }
    },
    {
      id: 'close-tab',
      title: 'Close Tab',
      hint: '⌘W',
      run: () => {
        if (activePath) closeTab(activePath)
      }
    }
  ]

  // The active file's position among its reading-ordered `.md` siblings, for the
  // Inspector — derived from the already-sorted tree (matches the explorer).
  const readingPosition = (() => {
    if (!activePath) return null
    const files = siblingsOf(activePath).filter(
      (n) => n.type === 'file' && n.name.endsWith('.md')
    )
    const index = files.findIndex((n) => n.path === activePath)
    return index === -1 ? null : { index: index + 1, total: files.length }
  })()

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar__group">
          <button className="toggle" onClick={() => void openProject()}>
            Open Project…
          </button>
          <span className="toolbar__project">{project.name}</span>
        </div>
        <div className="toolbar__group">
          <button
            className={`toggle${searchOpen ? ' toggle--on' : ''}`}
            title="Search across all files (⌘/Ctrl+Shift+F). Use ⌘/Ctrl+F to find in the current file."
            onClick={() => setSearchOpen((v) => !v)}
          >
            Find in Project
          </button>
          <button
            className={`toggle${refsOpen ? ' toggle--on' : ''}`}
            title="Find every mention of a character/entity. Cmd/Ctrl+click a mention to jump to its profile."
            onClick={() => setRefsOpen((v) => !v)}
          >
            References
          </button>
          <button
            className={`toggle${companionOpen ? ' toggle--on' : ''}`}
            title="Companion: keep character sheets & notes at hand — auto-follows the scene, pin to keep one in view"
            onClick={() => setCompanionOpen((v) => !v)}
          >
            Companion
          </button>
          <button
            className={`toggle${threadsOpen ? ' toggle--on' : ''}`}
            title="Threads: each storyline's beats in order, across the manuscript"
            onClick={() => setThreadsOpen((v) => !v)}
          >
            Threads
          </button>
          <button
            className={`toggle${braidOpen ? ' toggle--on' : ''}`}
            title="Braid: a visual map of how threads run through the manuscript"
            onClick={() => setBraidOpen((v) => !v)}
          >
            Braid
          </button>
          <button
            className={`toggle${inspectorOpen ? ' toggle--on' : ''}`}
            title="Inspector: what the app parses from the current file (title, order, threads, mentions, warnings)"
            onClick={() => setInspectorOpen((v) => !v)}
          >
            Inspector
          </button>
          <button
            className={`toggle${vim ? ' toggle--on' : ''}`}
            onClick={() => setVim((v) => !v)}
          >
            Vim: {vim ? 'on' : 'off'}
          </button>
          <button
            className={`toggle${diagnostics ? ' toggle--on' : ''}`}
            onClick={() => setDiagnostics((d) => !d)}
          >
            Diagnostics: {diagnostics ? 'on' : 'off'}
          </button>
          <button
            className={`toggle${autosave ? ' toggle--on' : ''}`}
            title="Auto-save edits a moment after you stop typing"
            onClick={() => setAutosave((a) => !a)}
          >
            Autosave: {autosave ? 'on' : 'off'}
          </button>
          <button
            className="toggle"
            title="Reload from disk — re-scan the project for changes made outside the app"
            onClick={() => void forceRefresh()}
          >
            ↻ Reload
          </button>
        </div>
      </header>

      <div
        className="body"
        style={{ '--panel-width': `${panelWidth}px` } as CSSProperties}
      >
        <aside className="sidebar" style={{ width: sidebarWidth }}>
          <div className="sidebar__header">
            <span className="sidebar__title">{project.name}</span>
            <div className="sidebar__actions">
              <button
                className="icon-btn"
                title="New file in project root"
                onClick={() => tree && setModal({ kind: 'newFile', dir: tree.path })}
              >
                ＋ File
              </button>
              <button
                className="icon-btn"
                title="New folder in project root"
                onClick={() => tree && setModal({ kind: 'newFolder', dir: tree.path })}
              >
                ＋ Folder
              </button>
            </div>
          </div>
          {tree ? (
            <FileTree
              root={tree}
              activePath={activePath}
              entityIcons={entityIcons}
              onSelect={(path) => openFile(path)}
              onNewFile={(dir) => setModal({ kind: 'newFile', dir })}
              onNewFolder={(dir) => setModal({ kind: 'newFolder', dir })}
              onRename={(node) => setModal({ kind: 'rename', node })}
              onDelete={(node) => setModal({ kind: 'delete', node })}
              onDrop={(draggedPath, target) => void handleDrop(draggedPath, target)}
            />
          ) : (
            <p className="tree-empty">Loading…</p>
          )}
        </aside>

        <div
          className="divider"
          role="separator"
          title="Drag to resize"
          onMouseDown={startSidebarResize}
        />

        <main className="main" style={editorStyle}>
          {braidOpen ? (
            <BraidView
              sceneOrder={projectFiles.map((f) => f.path)}
              refreshKey={inspectorRefresh}
              onOpen={(path) => {
                openFile(path)
                setBraidOpen(false)
              }}
              onClose={() => setBraidOpen(false)}
            />
          ) : (
            <>
              {openPaths.length > 0 && (
                <div className="tabstrip">
                  {openPaths.map((p) => (
                    <div
                      key={p}
                      className={`tabstrip__tab${p === activePath ? ' tabstrip__tab--active' : ''}`}
                      title={p}
                      onClick={() => switchTo(p)}
                    >
                      <span className="tabstrip__name">{basename(p)}</span>
                      {dirtyPaths.has(p) && <span className="tabstrip__dot" />}
                      <button
                        className="tabstrip__close"
                        title="Close (⌘/Ctrl+W)"
                        onClick={(e) => {
                          e.stopPropagation()
                          closeTab(p)
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {doc ? (
                <Editor
                  doc={doc}
                  vimEnabled={vim}
                  diagnosticsEnabled={diagnostics}
                  analysis={analysis}
                  onStatus={setStatus}
                  onDocChange={handleDocChange}
                  revealTarget={revealTarget}
                  onGoToDefinition={goToDefinition}
                  handleRef={editorHandle}
                />
              ) : (
                <div className="placeholder">Select a file to start editing.</div>
              )}
            </>
          )}
        </main>

        {(searchOpen || refsOpen || inspectorOpen || companionOpen || threadsOpen) && (
          <div
            className="divider divider--panel"
            role="separator"
            title="Drag to resize"
            onMouseDown={startPanelResize}
          />
        )}

        {searchOpen && (
          <ProjectSearch
            onClose={() => setSearchOpen(false)}
            onOpenMatch={(path, line, column) => openFile(path, { line, column })}
          />
        )}

        {refsOpen && (
          <ReferencesPanel
            entities={entities}
            entityTypes={entityTypes}
            onClose={() => setRefsOpen(false)}
            onOpenRef={(path, line, column, length) =>
              openFile(path, { line, column, endColumn: column + length })
            }
            onOpenProfile={(entity) => openFile(entity.path)}
          />
        )}

        {inspectorOpen && (
          <InspectorPanel
            path={activePath}
            readingPosition={readingPosition}
            refreshKey={inspectorRefresh}
            entityTypes={entityTypes}
            onClose={() => setInspectorOpen(false)}
          />
        )}

        {companionOpen && (
          <CompanionPanel
            activePath={activePath}
            pinnedPaths={pinnedPaths}
            onTogglePin={togglePin}
            onOpenFull={(path) => openFile(path)}
            refreshKey={inspectorRefresh}
            entityTypes={entityTypes}
            onClose={() => setCompanionOpen(false)}
          />
        )}

        {threadsOpen && (
          <ThreadsPanel
            onOpenBeat={(path) => openFile(path)}
            refreshKey={inspectorRefresh}
            onClose={() => setThreadsOpen(false)}
          />
        )}
      </div>

      <footer className="statusbar">
        <span>
          {activePath ? basename(activePath) : 'No file open'}
          {dirty && <span className="statusbar__dot" title="Unsaved changes" />}
        </span>
        <span>{status.words} words</span>
        <span>
          Ln {status.cursor.line}, Col {status.cursor.column}
        </span>
        <span className="statusbar__hint">
          {notice ?? (
            <>
              {dirty ? 'Unsaved' : 'Saved'} ·{' '}
              <code>{navigator.platform.startsWith('Mac') ? '⌘S' : 'Ctrl+S'}</code> to
              save
            </>
          )}
        </span>
      </footer>

      {modal?.kind === 'newFile' && (
        <PromptModal
          title="New File"
          label="File name (defaults to .md)"
          submitLabel="Create"
          onCancel={() => setModal(null)}
          onSubmit={(name) => {
            setModal(null)
            void createFileIn(modal.dir, name)
          }}
        />
      )}
      {modal?.kind === 'newFolder' && (
        <PromptModal
          title="New Folder"
          label="Folder name"
          submitLabel="Create"
          onCancel={() => setModal(null)}
          onSubmit={(name) => {
            setModal(null)
            void createFolderIn(modal.dir, name)
          }}
        />
      )}
      {modal?.kind === 'rename' && (
        <PromptModal
          title="Rename"
          label="New name"
          initialValue={basename(modal.node.path)}
          submitLabel="Rename"
          onCancel={() => setModal(null)}
          onSubmit={(name) => {
            setModal(null)
            void renameNode(modal.node, name)
          }}
        />
      )}
      {modal?.kind === 'delete' && (
        <ConfirmModal
          title="Delete"
          danger
          confirmLabel="Delete"
          message={`Delete "${basename(modal.node.path)}"${
            modal.node.type === 'directory' ? ' and everything inside it' : ''
          }? This cannot be undone.`}
          onCancel={() => setModal(null)}
          onConfirm={() => {
            setModal(null)
            void deleteNode(modal.node)
          }}
        />
      )}

      {closingTab && (
        <UnsavedChangesModal
          filename={basename(closingTab)}
          onSave={() => void resolveClosing('save')}
          onDiscard={() => void resolveClosing('discard')}
          onCancel={() => setClosingTab(null)}
        />
      )}

      {quickInput !== null && (
        <QuickInput
          files={projectFiles}
          commands={commands}
          initialQuery={quickInput}
          onClose={() => setQuickInput(null)}
          onOpenFile={(path) => openFile(path)}
        />
      )}
    </div>
  )
}
