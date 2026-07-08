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
import {
  ConfirmModal,
  NewFileModal,
  PromptModal,
  UnsavedChangesModal
} from './components/Modal'
import { BraidView } from './components/BraidView'
import { CommentsPanel } from './components/CommentsPanel'
import { CompanionPanel } from './components/CompanionPanel'
import { HealthPanel } from './components/HealthPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { ProjectSearch } from './components/ProjectSearch'
import { ReferencesPanel } from './components/ReferencesPanel'
import { ThreadsPanel } from './components/ThreadsPanel'
import { QuickInput, type QuickCommand, type QuickFile } from './components/QuickInput'
import { Icon } from './components/Icon'
import { SyntaxHelp } from './components/SyntaxHelp'
import { AnalysisService } from './analysis/analysis-service'
import { createEntityProvider } from './analysis/providers/entity-provider'
import { createFrontmatterProvider } from './analysis/providers/frontmatter-provider'
import { createSpellProvider } from './analysis/providers/spell-provider'
import type { EditorDoc } from './editor/types'
import type {
  Entity,
  OpenProjectResult,
  ProjectMeta,
  RecentProject,
  ThemeDef,
  TreeNode
} from '@shared/types'
import { BUILTIN_THEME_OPTIONS, resolveTheme, tokenProp } from './lib/theme'
import { entityTypeMeta, resolveEntityTypes } from '@shared/entity-types'
import { entityTemplate } from './lib/entity-template'
import {
  basename,
  isInsideDir,
  joinPath,
  parentDir,
  posixDir,
  posixRelativePath,
  projectRelative
} from './lib/paths'
import { entityAt, mentionRangeAt } from './lib/mentions'
import { parseEntityHead, detectRename, type EntityHead } from './lib/rename'

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
  | { kind: 'newFile'; dir: string; entityType?: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'rename'; node: TreeNode }
  | { kind: 'delete'; node: TreeNode }
  | null

/** Accent options from the Writer Design System (data-accent values). */
const ACCENTS = ['ink', 'sage', 'clay', 'plum', 'gold', 'slate']

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
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [healthOpen, setHealthOpen] = useState(false)
  // Pending alias-rename offer (a debounced frontmatter edit renamed a surface).
  const [renamePrompt, setRenamePrompt] = useState<{
    from: string
    to: string
    count: number
    files: number
  } | null>(null)
  // Live text of the active file, tracked only while the Comments panel is open
  // (so it stays live as you type) — avoids per-keystroke App renders otherwise.
  const [docText, setDocText] = useState('')
  // Bumped after a save / entity change so the disk-based Inspector + Companion
  // re-read the active file.
  const [inspectorRefresh, setInspectorRefresh] = useState(0)
  // Companion pins for the current project (paths); the full per-project map lives
  // in allPinsRef so persisting one project never clobbers another's.
  const [pinnedPaths, setPinnedPaths] = useState<string[]>([])
  // Explorer-pinned files for the current project (quick access, top of the tree).
  const [explorerPins, setExplorerPins] = useState<string[]>([])
  // Story entities (StoryIndex), for the references panel + go-to-definition.
  const [entities, setEntities] = useState<Entity[]>([])
  // null = closed; otherwise the initial query ('' = Quick Open, '>' = palette).
  const [quickInput, setQuickInput] = useState<string | null>(null)
  const [revealTarget, setRevealTarget] = useState<(Reveal & { nonce: number }) | null>(
    null
  )
  const [vim, setVim] = useState(false)
  // Vim j/k move by display line (gj/gk) — better for wrapped prose. Default on.
  const [vimWrapMotion, setVimWrapMotion] = useState(true)
  // Live Vim mode from the editor ('normal'|'insert'|'visual'|'replace', or ''
  // when Vim is off) — drives the status-bar mode chip + mode-coloured cursor.
  const [vimMode, setVimMode] = useState('')
  const [diagnostics, setDiagnostics] = useState(false)
  const [autosave, setAutosave] = useState(false)
  // Appearance (Phase 8) — persisted globally in app-settings, applied as
  // data-* attributes on <html>. 'auto' theme follows the OS preference.
  // Theme id: 'auto' | 'light' | 'dark' | a custom theme's id (Phase 8).
  const [theme, setTheme] = useState('auto')
  const [accent, setAccent] = useState('ink')
  const [focusMode, setFocusMode] = useState(false)
  // User-defined themes (from settings.json); project themes come off the config.
  const [userThemes, setUserThemes] = useState<ThemeDef[]>([])
  // Menubar: which dropdown is open (null = none); explorer visibility.
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [sidebarHidden, setSidebarHidden] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const [status, setStatus] = useState<EditorStatus>({
    words: 0,
    cursor: { line: 1, column: 1 }
  })

  const docsRef = useRef(new Map<string, OpenBuffer>())
  // Whether the Comments panel is open, read inside the stable doc-change handler.
  const commentsOpenRef = useRef(false)
  // Navigation history (back/forward through visited files) + button enabled state.
  const navStack = useRef<string[]>([])
  const navIndex = useRef(-1)
  const navigating = useRef(false)
  const [navState, setNavState] = useState({ back: false, forward: false })
  // Session recency for Quick Open (files) + command palette (command ids).
  const [recentFiles, setRecentFiles] = useState<string[]>([])
  const [recentCommands, setRecentCommands] = useState<string[]>([])
  // Alias-rename detection: baseline heads per entity path (saved state), a debounce
  // timer, and renames the user has skipped this session.
  const entityHeadBaseline = useRef(new Map<string, EntityHead>())
  const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissedRenames = useRef(new Set<string>())
  const revealNonce = useRef(0)
  const didInit = useRef(false)
  // Live handle onto the editor, for palette-driven go-to-definition (reads the
  // cursor while the editor is unfocused behind the palette).
  const editorHandle = useRef<EditorHandle | null>(null)
  // The whole Companion pins map (project root → paths), loaded from settings.
  const allPinsRef = useRef<Record<string, string[]>>({})
  // The whole explorer-pins map (project root → paths), loaded from settings.
  const allExplorerPinsRef = useRef<Record<string, string[]>>({})
  // Custom-theme token props currently set inline on <html>, so we can clear them
  // when switching themes (Phase 8).
  const appliedThemeTokens = useRef<string[]>([])

  // Themes available in the picker: user themes (settings) + this project's themes.
  const availableThemes = useMemo<ThemeDef[]>(
    () => [...userThemes, ...(project?.config.themes ?? [])],
    [userThemes, project]
  )

  // The doc handed to the editor — keyed on the active tab only, so typing (which
  // mutates the buffer in the ref) never re-loads the editor. Switching tabs
  // recomputes and loads that tab's live buffer.
  const doc = useMemo<EditorDoc | null>(
    () => (activePath ? { uri: activePath, text: activeLoadText } : null),
    [activePath, activeLoadText]
  )

  const dirty = activePath ? dirtyPaths.has(activePath) : false

  // The active file's project-relative folder — resolves `![](src)` image paths
  // and lets us insert a file-relative path when importing.
  const assetDir = useMemo(
    () =>
      project && activePath ? posixDir(projectRelative(project.root, activePath)) : '',
    [project, activePath]
  )

  // Insert an imported image (given its project-relative path) at the cursor, as
  // a path relative to the current file; refresh the tree so assets/ shows.
  const insertProjectImage = useCallback(
    (projectRelPath: string) => {
      const src = posixRelativePath(assetDir, projectRelPath)
      const alt = basename(projectRelPath).replace(/\.[^.]+$/, '')
      editorHandle.current?.insertImage(alt, src)
      void window.api.readTree().then(setTree)
    },
    [assetDir]
  )

  const insertImageFromPicker = useCallback(async () => {
    const res = await window.api.pickImage()
    if (res) insertProjectImage(res.path)
  }, [insertProjectImage])

  const onImageDropped = useCallback(
    async (paths: string[]) => {
      for (const p of paths) {
        const res = await window.api.importImageFile(p)
        if (res) insertProjectImage(res.path)
      }
    },
    [insertProjectImage]
  )

  // The analysis facade + its providers (Phase 4). Created once; the editor
  // talks only to this, never to a provider (SPEC seam).
  const entityProvider = useMemo(() => createEntityProvider(), [])
  const frontmatterProvider = useMemo(() => createFrontmatterProvider(), [])
  const analysis = useMemo(() => {
    const service = new AnalysisService()
    service.register(entityProvider.provider)
    service.register(frontmatterProvider.provider)
    service.register(createSpellProvider())
    return service
  }, [entityProvider, frontmatterProvider])
  useEffect(() => () => analysis.dispose(), [analysis])

  // Load story entities (characters, locations, items, …) from StoryIndex;
  // refresh after edits. Feeds the completion provider, references/
  // go-to-definition, and (via the refresh nonce) the disk-based Inspector +
  // Companion scene detection.
  const refreshEntities = useCallback(() => {
    void window.api.storyEntities().then((next) => {
      entityProvider.setEntities(next)
      frontmatterProvider.setEntities(next)
      setEntities(next)
    })
    setInspectorRefresh((n) => n + 1)
  }, [entityProvider, frontmatterProvider])

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

  // Pin/unpin a file to the explorer's quick-access section (per project).
  const toggleExplorerPin = useCallback(
    (path: string) => {
      if (!project) return
      const current = allExplorerPinsRef.current[project.root] ?? []
      const next = current.includes(path)
        ? current.filter((p) => p !== path)
        : [...current, path]
      allExplorerPinsRef.current = { ...allExplorerPinsRef.current, [project.root]: next }
      setExplorerPins(next)
      void window.api.updateSettings({ explorerPins: allExplorerPinsRef.current })
    },
    [project]
  )

  // Flat list of the project's .md files for Quick Open (Cmd/Ctrl+P). `rel` is
  // the file's directory relative to the project root ('' at the root), shown as
  // a dimmed hint so the full file name always reads.
  const projectFiles = useMemo<QuickFile[]>(() => {
    const rootLen = project ? project.root.length + 1 : 0
    const out: QuickFile[] = []
    const walk = (node: TreeNode) => {
      if (node.type === 'file') {
        if (node.name.endsWith('.md')) {
          const relPath = node.path.slice(rootLen)
          const slash = relPath.lastIndexOf('/')
          out.push({
            path: node.path,
            name: node.name,
            rel: slash >= 0 ? relPath.slice(0, slash) : ''
          })
        }
      } else node.children?.forEach(walk)
    }
    tree?.children?.forEach(walk)
    return out
  }, [tree, project])

  // Registered entity types (Phase 7, M18): built-in defaults with this project's
  // `entityTypes` merged over them. Drives type badges, frontmatter intellisense,
  // and new-file templates — one source of truth for every "what is a location?".
  const entityTypes = useMemo(() => resolveEntityTypes(project?.config), [project])

  // Feed the registry to the frontmatter completer (M19) so `type:`/field
  // suggestions track the open project's schema.
  useEffect(() => {
    frontmatterProvider.setEntityTypes(entityTypes)
  }, [frontmatterProvider, entityTypes])

  // Icon per profile file, so the tree can badge a location vs. an item. Keyed by
  // path off the entity list (only files with a `type:` appear).
  const entityIcons = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of entities)
      map.set(e.path, entityTypeMeta(e.type, entityTypes).iconName)
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

  // Baseline of each entity's identity surfaces (saved state), for detecting an
  // in-place alias/name rename as you edit the frontmatter.
  useEffect(() => {
    const map = new Map<string, EntityHead>()
    for (const e of entities) map.set(e.path, { name: e.name, aliases: e.aliases })
    entityHeadBaseline.current = map
    dismissedRenames.current.clear()
  }, [entities])

  // Debounced: when an entity file's frontmatter renames a surface, offer to
  // update its `@{…}` mentions across the manuscript (Phase 9 rename refactor).
  const detectAndOfferRename = useCallback((path: string, text: string) => {
    const base = entityHeadBaseline.current.get(path)
    if (!base) return // not an entity file
    const cur = parseEntityHead(text)
    if (!cur) return
    const rename = detectRename(base, cur)
    if (!rename || dismissedRenames.current.has(`${rename.from}=>${rename.to}`)) return
    void window.api.countMentions(rename.from).then(({ count, files }) => {
      if (count > 0) setRenamePrompt({ from: rename.from, to: rename.to, count, files })
    })
  }, [])

  const handleDocChange = useCallback(
    (text: string) => {
      if (!activePath) return
      const buffer = docsRef.current.get(activePath)
      if (!buffer) return
      buffer.current = text
      markDirty(activePath, text !== buffer.saved)
      if (commentsOpenRef.current) setDocText(text)
      // Watch entity-file frontmatter for a rename (debounced ~1s).
      if (entityHeadBaseline.current.has(activePath)) {
        if (renameTimer.current) clearTimeout(renameTimer.current)
        const path = activePath
        renameTimer.current = setTimeout(() => detectAndOfferRename(path, text), 1000)
      }
    },
    [activePath, markDirty, detectAndOfferRename]
  )

  // Keep the Comments panel's text current: seed it when the panel opens or the
  // file switches; live edits flow in via handleDocChange while it's open.
  useEffect(() => {
    commentsOpenRef.current = commentsOpen
    if (commentsOpen && activePath) {
      setDocText(docsRef.current.get(activePath)?.current ?? activeLoadText)
    }
  }, [commentsOpen, activePath, activeLoadText])

  // Apply the pending rename: rewrite @{from}→@{to} across files (skipping any
  // open with unsaved edits), reload the touched buffers, and refresh the index.
  const applyRename = useCallback(async () => {
    const p = renamePrompt
    setRenamePrompt(null)
    if (!p) return
    const dirtyOpen = openPaths.filter((path) => dirtyPaths.has(path))
    const result = await window.api.renameMentions(p.from, p.to, dirtyOpen)
    for (const path of result.changed) {
      if (!docsRef.current.has(path)) continue
      const r = await window.api.readFile(path)
      if (!r.ok) continue
      docsRef.current.set(path, { saved: r.text, current: r.text })
      setDirtyPaths((prev) => {
        const next = new Set(prev)
        next.delete(path)
        return next
      })
      if (path === activePath) setActiveLoadText(r.text)
    }
    refreshEntities()
    setInspectorRefresh((n) => n + 1)
    setNotice(
      result.skipped.length
        ? `Renamed ${result.count} mention(s). Skipped ${result.skipped.length} file(s) with unsaved edits — update those from Project Health.`
        : `Renamed ${result.count} mention(s) to @{${p.to}}.`
    )
  }, [renamePrompt, openPaths, dirtyPaths, activePath, refreshEntities])

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
      // A project can ship a default look (project.json `theme`). Applied for the
      // session without persisting to the global setting — the picker still wins.
      if (result.project.config.theme) setTheme(result.project.config.theme)
      setPinnedPaths(allPinsRef.current[result.project.root] ?? [])
      setExplorerPins(allExplorerPinsRef.current[result.project.root] ?? [])
      refreshEntities()
    },
    [refreshEntities]
  )

  const openProject = useCallback(async () => {
    await applyOpenResult(await window.api.openProject())
  }, [applyOpenResult])

  const newProject = useCallback(async () => {
    await applyOpenResult(await window.api.newProject())
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
      if (settings.theme) setTheme(settings.theme)
      if (settings.accent) setAccent(settings.accent)
      if (settings.focusMode) setFocusMode(settings.focusMode)
      if (settings.userThemes) setUserThemes(settings.userThemes)
      if (settings.vim) setVim(settings.vim)
      if (settings.vimWrapMotion !== undefined) setVimWrapMotion(settings.vimWrapMotion)
      allPinsRef.current = settings.pins ?? {}
      allExplorerPinsRef.current = settings.explorerPins ?? {}
      const last = settings.recentProjects[0]
      if (last) await openRecent(last.path)
    })()
  }, [openRecent])

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

  // Appearance setters that also persist the choice globally.
  const changeTheme = useCallback((next: string) => {
    setTheme(next)
    void window.api.updateSettings({ theme: next })
  }, [])
  const setAccentTo = useCallback((next: string) => {
    setAccent(next)
    void window.api.updateSettings({ accent: next })
  }, [])
  const cycleAccent = useCallback(() => {
    setAccentTo(ACCENTS[(ACCENTS.indexOf(accent) + 1) % ACCENTS.length])
  }, [accent, setAccentTo])
  const toggleFocus = useCallback(() => {
    const next = !focusMode
    setFocusMode(next)
    void window.api.updateSettings({ focusMode: next })
  }, [focusMode])
  const toggleVim = useCallback(() => {
    const next = !vim
    setVim(next)
    void window.api.updateSettings({ vim: next })
  }, [vim])
  const toggleVimWrapMotion = useCallback(() => {
    const next = !vimWrapMotion
    setVimWrapMotion(next)
    void window.api.updateSettings({ vimWrapMotion: next })
  }, [vimWrapMotion])

  // --- explorer file operations (M4) ---

  async function createFileIn(dir: string, name: string, entityType?: string) {
    const fileName = name.includes('.') ? name : `${name}.md`
    const path = joinPath(dir, fileName)
    const result = await window.api.createFile(path)
    if (!result.ok) {
      setNotice(`Couldn't create file: ${result.error}`)
      return
    }
    // Seed a chosen entity type's frontmatter skeleton (M20); blank otherwise.
    if (entityType) {
      const def = entityTypeMeta(entityType, entityTypes)
      const written = await window.api.writeFile(path, entityTemplate(def, name))
      if (!written.ok) setNotice(`Couldn't write template: ${written.error}`)
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
    focusExplorer: () => {},
    back: () => {},
    forward: () => {}
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
      focusExplorer: () => document.querySelector<HTMLElement>('.tree')?.focus(),
      back: goBack,
      forward: goForward
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
      // Back / forward through visited files (⌃− / ⌃⇧−; Ctrl, not Cmd, to dodge
      // the OS zoom shortcut).
      if (e.ctrlKey && !e.metaKey && (e.key === '-' || e.key === '_')) {
        e.preventDefault()
        if (e.shiftKey) navRef.current.forward()
        else navRef.current.back()
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
        <p>Start a new project, or open an existing folder.</p>
        <div className="welcome__actions">
          <button className="welcome__open" onClick={() => void newProject()}>
            New Project…
          </button>
          <button
            className="welcome__open welcome__open--ghost"
            onClick={() => void openProject()}
          >
            Open Project…
          </button>
        </div>
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
    // Fall back to the theme's reading font (so a theme like Terminal can retint
    // the prose to mono); an explicit project editor.font still wins.
    '--editor-font': ed?.font ? fontStack(ed.font) : 'var(--font-reading)',
    '--editor-font-size': ed?.fontSize ? `${ed.fontSize}px` : '16px',
    '--editor-line-height': ed?.lineHeight ? String(ed.lineHeight) : '1.7'
  } as CSSProperties

  // Command registry (SPEC → command palette). Declared once here; the palette,
  // and later menus/keybindings, draw from it.
  const commands: QuickCommand[] = [
    { id: 'nav-back', title: 'Go Back', hint: '⌃−', run: () => goBack() },
    { id: 'nav-forward', title: 'Go Forward', hint: '⌃⇧−', run: () => goForward() },
    { id: 'new-project', title: 'New Project…', run: () => void newProject() },
    { id: 'open-project', title: 'Open Project…', run: () => void openProject() },
    {
      id: 'format-bold',
      title: 'Bold',
      hint: '⌘B',
      run: () => editorHandle.current?.format('bold')
    },
    {
      id: 'format-italic',
      title: 'Italic',
      hint: '⌘I',
      run: () => editorHandle.current?.format('italic')
    },
    {
      id: 'format-link',
      title: 'Insert Link',
      hint: '⌘K',
      run: () => editorHandle.current?.format('link')
    },
    {
      id: 'new-file',
      title: 'New File',
      run: () => tree && setModal({ kind: 'newFile', dir: tree.path })
    },
    // One "New <Type>" per registered entity type (M20) — opens the New-File
    // modal with that type preselected, seeding its frontmatter skeleton.
    ...entityTypes.map((t) => ({
      id: `new-${t.type}`,
      title: `New ${t.label}`,
      run: () => tree && setModal({ kind: 'newFile', dir: tree.path, entityType: t.type })
    })),
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
      run: () => toggleVim()
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
      id: 'theme-light',
      title: 'Theme: Warm Paper (Light)',
      run: () => changeTheme('light')
    },
    {
      id: 'theme-dark',
      title: 'Theme: Warm Dusk (Dark)',
      run: () => changeTheme('dark')
    },
    {
      id: 'theme-auto',
      title: 'Theme: Match System',
      run: () => changeTheme('auto')
    },
    {
      id: 'cycle-accent',
      title: `Cycle Accent (${accent})`,
      run: () => cycleAccent()
    },
    {
      id: 'toggle-focus',
      title: `Toggle Focus Mode (${focusMode ? 'on' : 'off'})`,
      run: () => toggleFocus()
    },
    {
      id: 'add-comment',
      title: 'Add Comment',
      run: () => editorHandle.current?.format('comment')
    },
    {
      id: 'suggest-delete',
      title: 'Suggest Deletion (track change)',
      run: () => editorHandle.current?.format('suggest-delete')
    },
    {
      id: 'suggest-insert',
      title: 'Suggest Insertion (track change)',
      run: () => editorHandle.current?.format('suggest-insert')
    },
    {
      id: 'accept-change',
      title: 'Accept Change at Cursor',
      run: () => editorHandle.current?.resolveChange(true)
    },
    {
      id: 'reject-change',
      title: 'Reject Change at Cursor',
      run: () => editorHandle.current?.resolveChange(false)
    },
    {
      id: 'format-table',
      title: 'Format Table (align columns)',
      run: () => editorHandle.current?.formatTable()
    },
    {
      id: 'insert-image',
      title: 'Insert Image…',
      run: () => void insertImageFromPicker()
    },
    {
      id: 'syntax-reference',
      title: 'Markdown & Syntax Reference',
      run: () => setHelpOpen(true)
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
      <header className="menubar">
        <div className="menubar__left">
          <span className="menubar__brand">Writer</span>
          <span className="menubar__project" title={project.root}>
            {project.name}
          </span>
        </div>

        <nav className="menubar__menus">
          <button
            className="menubar__nav"
            title="Back (⌃−)"
            disabled={!navState.back}
            onClick={goBack}
          >
            ‹
          </button>
          <button
            className="menubar__nav"
            title="Forward (⌃⇧−)"
            disabled={!navState.forward}
            onClick={goForward}
          >
            ›
          </button>
          <button className="menubar__item" onClick={() => void newProject()}>
            New…
          </button>
          <button className="menubar__item" onClick={() => void openProject()}>
            Open…
          </button>
          <button
            className={`menubar__item${searchOpen ? ' menubar__item--active' : ''}`}
            title="Search across all files (⌘/Ctrl+Shift+F)"
            onClick={() => setSearchOpen((v) => !v)}
          >
            Find
          </button>
          <div className="menu">
            <button
              className={`menubar__item${menuOpen === 'view' ? ' menubar__item--open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen === 'view'}
              onClick={() => setMenuOpen((m) => (m === 'view' ? null : 'view'))}
            >
              View ▾
            </button>
            {menuOpen === 'view' && (
              <>
                <div className="menu__backdrop" onClick={() => setMenuOpen(null)} />
                <div className="menu-pop" role="menu">
                  <div className="menu-pop__label">Panels</div>
                  {(
                    [
                      ['References', refsOpen, () => setRefsOpen((v) => !v)],
                      ['Companion', companionOpen, () => setCompanionOpen((v) => !v)],
                      ['Threads', threadsOpen, () => setThreadsOpen((v) => !v)],
                      ['Thread braid', braidOpen, () => setBraidOpen((v) => !v)],
                      ['Comments', commentsOpen, () => setCommentsOpen((v) => !v)],
                      ['Inspector', inspectorOpen, () => setInspectorOpen((v) => !v)],
                      ['Project Health', healthOpen, () => setHealthOpen((v) => !v)]
                    ] as [string, boolean, () => void][]
                  ).map(([label, on, toggle]) => (
                    <button
                      key={label}
                      className="menu-pop__row"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => {
                        toggle()
                        setMenuOpen(null)
                      }}
                    >
                      <span className="menu-pop__check">{on ? '✓' : ''}</span>
                      {label}
                    </button>
                  ))}

                  <div className="menu-pop__sep" />
                  <div className="menu-pop__label">Theme</div>
                  {[
                    ...BUILTIN_THEME_OPTIONS,
                    ...availableThemes.map((t) => ({ id: t.id, name: t.name }))
                  ].map(({ id, name }) => (
                    <button
                      key={id}
                      className="menu-pop__row"
                      role="menuitemradio"
                      aria-checked={theme === id}
                      onClick={() => {
                        changeTheme(id)
                        setMenuOpen(null)
                      }}
                    >
                      <span className="menu-pop__check">{theme === id ? '✓' : ''}</span>
                      {name}
                    </button>
                  ))}
                  <div className="menu-pop__row menu-pop__row--static">
                    <span className="menu-pop__check" />
                    Accent
                    <span className="menu-pop__swatches">
                      {ACCENTS.map((a) => (
                        <button
                          key={a}
                          className={`swatch${accent === a ? ' swatch--on' : ''}`}
                          data-accent={a}
                          title={a}
                          onClick={() => setAccentTo(a)}
                        />
                      ))}
                    </span>
                  </div>
                  <button
                    className="menu-pop__row"
                    role="menuitemcheckbox"
                    aria-checked={focusMode}
                    onClick={() => {
                      toggleFocus()
                      setMenuOpen(null)
                    }}
                  >
                    <span className="menu-pop__check">{focusMode ? '✓' : ''}</span>
                    Focus mode
                  </button>

                  <div className="menu-pop__sep" />
                  <div className="menu-pop__label">Editor</div>
                  {(
                    [
                      ['Vim keys', vim, toggleVim],
                      ['Diagnostics', diagnostics, () => setDiagnostics((v) => !v)],
                      ['Autosave', autosave, () => setAutosave((v) => !v)]
                    ] as [string, boolean, () => void][]
                  ).map(([label, on, toggle]) => (
                    <button
                      key={label}
                      className="menu-pop__row"
                      role="menuitemcheckbox"
                      aria-checked={on}
                      onClick={() => {
                        toggle()
                        setMenuOpen(null)
                      }}
                    >
                      <span className="menu-pop__check">{on ? '✓' : ''}</span>
                      {label}
                    </button>
                  ))}
                  {vim && (
                    <button
                      className="menu-pop__row"
                      role="menuitemcheckbox"
                      aria-checked={vimWrapMotion}
                      onClick={() => {
                        toggleVimWrapMotion()
                        setMenuOpen(null)
                      }}
                    >
                      <span className="menu-pop__check">{vimWrapMotion ? '✓' : ''}</span>
                      Wrapped-line motion (j/k)
                    </button>
                  )}

                  <div className="menu-pop__sep" />
                  <button
                    className="menu-pop__row"
                    onClick={() => {
                      void forceRefresh()
                      setMenuOpen(null)
                    }}
                  >
                    <span className="menu-pop__check" />
                    Reload from disk
                  </button>
                  <button
                    className="menu-pop__row"
                    onClick={() => {
                      setHelpOpen(true)
                      setMenuOpen(null)
                    }}
                  >
                    <span className="menu-pop__check" />
                    Markdown &amp; syntax reference
                  </button>
                </div>
              </>
            )}
          </div>
        </nav>

        <div className="menubar__right">
          <button
            className="ptog ptog--left"
            data-on={!sidebarHidden}
            title="Toggle explorer"
            onClick={() => setSidebarHidden((v) => !v)}
          >
            <span className="ptog__bar" />
          </button>
          <button
            className="ptog ptog--right"
            data-on={companionOpen}
            title="Toggle companion panel"
            onClick={() => setCompanionOpen((v) => !v)}
          >
            <span className="ptog__bar" />
          </button>
          <button
            className="menubar__cmd"
            title="Command palette (⌘/Ctrl+Shift+P)"
            onClick={() => setQuickInput('>')}
          >
            ⌘ Commands
          </button>
        </div>
      </header>

      <div
        className="body"
        style={{ '--panel-width': `${panelWidth}px` } as CSSProperties}
      >
        {!sidebarHidden && (
          <>
            <aside className="sidebar" style={{ width: sidebarWidth }}>
              <div className="sidebar__header">
                <span className="sidebar__title">{project.name}</span>
                <div className="sidebar__actions">
                  <button
                    className="icon-btn icon-btn--action"
                    aria-label="New file"
                    onClick={() => tree && setModal({ kind: 'newFile', dir: tree.path })}
                  >
                    <Icon name="file-plus" size={17} />
                    <span className="icon-btn__tip">New file</span>
                  </button>
                  <button
                    className="icon-btn icon-btn--action"
                    aria-label="New folder"
                    onClick={() =>
                      tree && setModal({ kind: 'newFolder', dir: tree.path })
                    }
                  >
                    <Icon name="folder-plus" size={17} />
                    <span className="icon-btn__tip">New folder</span>
                  </button>
                </div>
              </div>
              {tree ? (
                <FileTree
                  root={tree}
                  activePath={activePath}
                  entityIcons={entityIcons}
                  pinned={explorerPins}
                  onTogglePin={toggleExplorerPin}
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
          </>
        )}

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
              {doc && !vim && (
                <div className="formatbar" role="toolbar" aria-label="Formatting">
                  <button
                    className="fmt fmt--bold"
                    title="Bold (⌘/Ctrl+B)"
                    onClick={() => editorHandle.current?.format('bold')}
                  >
                    B
                  </button>
                  <button
                    className="fmt fmt--italic"
                    title="Italic (⌘/Ctrl+I)"
                    onClick={() => editorHandle.current?.format('italic')}
                  >
                    I
                  </button>
                  <span className="fmt-sep" />
                  <button
                    className="fmt"
                    title="Heading 1"
                    onClick={() => editorHandle.current?.format('h1')}
                  >
                    H1
                  </button>
                  <button
                    className="fmt"
                    title="Heading 2"
                    onClick={() => editorHandle.current?.format('h2')}
                  >
                    H2
                  </button>
                  <span className="fmt-sep" />
                  <button
                    className="fmt"
                    title="Bullet list"
                    onClick={() => editorHandle.current?.format('bullet')}
                  >
                    •
                  </button>
                  <button
                    className="fmt"
                    title="Numbered list"
                    onClick={() => editorHandle.current?.format('ordered')}
                  >
                    1.
                  </button>
                  <button
                    className="fmt fmt--quote"
                    title="Quote"
                    onClick={() => editorHandle.current?.format('quote')}
                  >
                    &rdquo;
                  </button>
                  <span className="fmt-sep" />
                  <button
                    className="fmt fmt--icon"
                    title="Link (⌘/Ctrl+K)"
                    onClick={() => editorHandle.current?.format('link')}
                  >
                    <Icon name="link" size={15} />
                  </button>
                  <button
                    className="fmt fmt--icon"
                    title="Add comment (editorial note, stripped on export)"
                    onClick={() => editorHandle.current?.format('comment')}
                  >
                    <Icon name="comment" size={15} />
                  </button>
                  <button
                    className="fmt fmt--help"
                    title="Markdown & syntax reference"
                    onClick={() => setHelpOpen(true)}
                  >
                    ?
                  </button>
                </div>
              )}
              {doc ? (
                <Editor
                  doc={doc}
                  vimEnabled={vim}
                  vimWrapMotion={vimWrapMotion}
                  diagnosticsEnabled={diagnostics}
                  analysis={analysis}
                  onStatus={setStatus}
                  onVimMode={setVimMode}
                  onDocChange={handleDocChange}
                  revealTarget={revealTarget}
                  onGoToDefinition={goToDefinition}
                  onResolveMention={(lineText, column) =>
                    mentionRangeAt(lineText, column, entities)
                  }
                  handleRef={editorHandle}
                  assetDir={assetDir}
                  onImageDropped={onImageDropped}
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

        {commentsOpen && (
          <CommentsPanel
            text={docText}
            onJump={(line, column) => fireReveal({ line, column })}
            onClose={() => setCommentsOpen(false)}
          />
        )}

        {healthOpen && (
          <HealthPanel
            refreshKey={inspectorRefresh}
            onOpen={(path, line, column, length) =>
              openFile(path, { line, column, endColumn: column + length })
            }
            onClose={() => setHealthOpen(false)}
          />
        )}

        {/* Panel rail — switch the right-pane panels from the pane itself. */}
        <nav className="rail" aria-label="Panels">
          {(
            [
              ['References', 'link', refsOpen, () => setRefsOpen((v) => !v)],
              [
                'Companion',
                'book-open',
                companionOpen,
                () => setCompanionOpen((v) => !v)
              ],
              ['Threads', 'thread', threadsOpen, () => setThreadsOpen((v) => !v)],
              ['Comments', 'comment', commentsOpen, () => setCommentsOpen((v) => !v)],
              ['Inspector', 'info', inspectorOpen, () => setInspectorOpen((v) => !v)],
              ['Project Health', 'activity', healthOpen, () => setHealthOpen((v) => !v)]
            ] as [string, string, boolean, () => void][]
          ).map(([label, icon, on, toggle]) => (
            <button
              key={label}
              className={`rail__btn${on ? ' rail__btn--active' : ''}`}
              aria-label={label}
              aria-pressed={on}
              onClick={toggle}
            >
              <Icon name={icon} size={18} />
              <span className="rail__tip">{label}</span>
            </button>
          ))}
        </nav>
      </div>

      <footer className="statusbar">
        {vim && vimMode && (
          <span className="statusbar__vim" data-vim-mode={vimMode}>
            {vimMode.toUpperCase()}
          </span>
        )}
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
        <NewFileModal
          options={[
            { value: '', label: 'Blank Markdown' },
            ...entityTypes.map((t) => ({ value: t.type, label: `${t.icon} ${t.label}` }))
          ]}
          initialType={modal.entityType}
          onCancel={() => setModal(null)}
          onSubmit={(name, entityType) => {
            setModal(null)
            void createFileIn(modal.dir, name, entityType || undefined)
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
          recentFiles={recentFiles}
          recentCommands={recentCommands}
          onRunCommand={(id) =>
            setRecentCommands((prev) =>
              [id, ...prev.filter((x) => x !== id)].slice(0, 20)
            )
          }
          onClose={() => setQuickInput(null)}
          // Reveal line 1 so the editor takes focus — land in the file ready to
          // type, not back in the quick-input.
          onOpenFile={(path) => openFile(path, { line: 1, column: 1 })}
        />
      )}

      {helpOpen && <SyntaxHelp onClose={() => setHelpOpen(false)} />}

      {renamePrompt && (
        <ConfirmModal
          title="Update mentions?"
          message={`You renamed @{${renamePrompt.from}} → @{${renamePrompt.to}}. Update ${renamePrompt.count} mention${
            renamePrompt.count === 1 ? '' : 's'
          } across ${renamePrompt.files} file${renamePrompt.files === 1 ? '' : 's'}?`}
          confirmLabel="Update"
          onConfirm={() => void applyRename()}
          onCancel={() => {
            dismissedRenames.current.add(`${renamePrompt.from}=>${renamePrompt.to}`)
            setRenamePrompt(null)
          }}
        />
      )}
    </div>
  )
}
