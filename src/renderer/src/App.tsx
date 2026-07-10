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
  ConflictModal,
  NewFileModal,
  PromptModal,
  UnsavedChangesModal
} from './components/Modal'
import { BraidView } from './components/BraidView'
import { CommentsPanel } from './components/CommentsPanel'
import { CompanionPanel } from './components/CompanionPanel'
import { FrontmatterPanel } from './components/FrontmatterPanel'
import { HealthPanel } from './components/HealthPanel'
import { InspectorPanel } from './components/InspectorPanel'
import { ProjectSearch } from './components/ProjectSearch'
import { ReferencesPanel } from './components/ReferencesPanel'
import { ThreadsPanel } from './components/ThreadsPanel'
import { QuickInput } from './components/QuickInput'
import { TabStrip } from './components/TabStrip'
import { ProjectSettings } from './components/ProjectSettings'
import { Icon } from './components/Icon'
import { Logo } from './components/Logo'
import { SaveStatus } from './components/SaveStatus'
import { Help } from './components/Help'
import type {
  OpenProjectResult,
  ProjectConfig,
  ProjectMeta,
  RecentProject,
  TreeNode
} from '@shared/types'
import { BUILTIN_THEME_OPTIONS } from './lib/theme'
import { usePanels } from './hooks/usePanels'
import { ACCENTS, useSettings } from './hooks/useSettings'
import { useDocuments } from './hooks/useDocuments'
import { useCommands } from './hooks/useCommands'
import { useLayout } from './hooks/useLayout'
import { useProject } from './hooks/useProject'
import { entityTypeMeta } from '@shared/entity-types'
import { entityTemplate } from './lib/entity-template'
import {
  basename,
  isImageFile,
  joinPath,
  parentDir,
  posixRelativePath
} from './lib/paths'
import { ImageView } from './components/ImageView'
import { mentionRangeAt } from './lib/mentions'
import { parseEntityHead, detectRename, type EntityHead } from './lib/rename'

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

export default function App() {
  const [project, setProject] = useState<ProjectMeta | null>(null)
  const [recents, setRecents] = useState<RecentProject[]>([])

  const [notice, setNotice] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  // Chrome layout: sidebar/panel widths + collapse — see useLayout.
  const layout = useLayout()
  // Right-hand panels + reference overlays (open/closed) — see usePanels.
  const panels = usePanels()
  // Appearance + editor preferences (theme/accent/vim/…) and their persistence.
  const projectThemes = useMemo(() => project?.config.themes ?? [], [project])
  const settings = useSettings(projectThemes)
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
  const bumpInspector = useCallback(() => setInspectorRefresh((n) => n + 1), [])
  // The open-document model: tabs, per-tab live buffers, save/close, nav history,
  // and the editor reveal signal — see useDocuments.
  const documents = useDocuments({
    projectRoot: project?.root ?? null,
    setNotice,
    onAfterSave: bumpInspector
  })
  // The open project's data domain: file tree, story index (entities) + analysis,
  // entity types, and per-project pins — see useProject.
  const projectData = useProject({
    project,
    openFile: documents.openFile,
    setNotice,
    bumpInspector
  })
  // null = closed; otherwise the initial query ('' = Quick Open, '>' = palette).
  const [quickInput, setQuickInput] = useState<string | null>(null)
  // Live Vim mode from the editor ('normal'|'insert'|'visual'|'replace', or ''
  // when Vim is off) — drives the status-bar mode chip + mode-coloured cursor.
  const [vimMode, setVimMode] = useState('')
  // Menubar: which dropdown is open (null = none).
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  // Project Settings form (edits project.json via controlled fields).
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [status, setStatus] = useState<EditorStatus>({
    words: 0,
    cursor: { line: 1, column: 1 }
  })

  // Whether a live-text panel (Comments / Frontmatter) is open, read inside the
  // stable doc-change handler so `docText` mirrors the editor while either is up.
  const commentsOpenRef = useRef(false)
  const frontmatterOpenRef = useRef(false)
  // Session recency for the command palette (command ids); file recency lives in
  // useDocuments.
  const [recentCommands, setRecentCommands] = useState<string[]>([])
  // Alias-rename detection: baseline heads per entity path (saved state), a debounce
  // timer, and renames the user has skipped this session.
  const entityHeadBaseline = useRef(new Map<string, EntityHead>())
  const renameTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissedRenames = useRef(new Set<string>())
  const didInit = useRef(false)
  // Live handle onto the editor, for palette-driven go-to-definition (reads the
  // cursor while the editor is unfocused behind the palette).
  const editorHandle = useRef<EditorHandle | null>(null)

  // Insert an imported image (given its project-relative path) at the cursor, as
  // a path relative to the current file; refresh the tree so assets/ shows.
  const insertProjectImage = useCallback(
    (projectRelPath: string) => {
      const src = posixRelativePath(documents.assetDir, projectRelPath)
      const alt = basename(projectRelPath).replace(/\.[^.]+$/, '')
      editorHandle.current?.insertImage(alt, src)
      void projectData.reloadTree()
    },
    [documents.assetDir, projectData.reloadTree]
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

  // Baseline of each entity's identity surfaces (saved state), for detecting an
  // in-place alias/name rename as you edit the frontmatter.
  useEffect(() => {
    const map = new Map<string, EntityHead>()
    for (const e of projectData.entities)
      map.set(e.path, { name: e.name, aliases: e.aliases })
    entityHeadBaseline.current = map
    dismissedRenames.current.clear()
  }, [projectData.entities])

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
      const path = documents.activePath
      if (!path) return
      documents.updateActiveBuffer(text)
      if (commentsOpenRef.current || frontmatterOpenRef.current) setDocText(text)
      // Watch entity-file frontmatter for a rename (debounced ~1s).
      if (entityHeadBaseline.current.has(path)) {
        if (renameTimer.current) clearTimeout(renameTimer.current)
        renameTimer.current = setTimeout(() => detectAndOfferRename(path, text), 1000)
      }
    },
    [documents.activePath, documents.updateActiveBuffer, detectAndOfferRename]
  )

  // Keep the Comments panel's text current: seed it from the live document buffer
  // when the panel opens or the file switches; live edits flow in via
  // handleDocChange while it's open. This is a deliberate external-sync — the
  // buffer lives in a ref (App doesn't re-render per keystroke), so the panel's
  // initial text must be pulled in here rather than derived during render.
  useEffect(() => {
    commentsOpenRef.current = panels.open.comments
    frontmatterOpenRef.current = panels.open.frontmatter
    if ((panels.open.comments || panels.open.frontmatter) && documents.activePath) {
      const seed = documents.currentText(documents.activePath) ?? documents.activeLoadText
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDocText(seed)
    }
  }, [
    panels.open.comments,
    panels.open.frontmatter,
    documents.activePath,
    documents.activeLoadText
  ])

  // Apply the frontmatter editor's block rewrite to the editor buffer as a
  // minimal range edit (keeps the body cursor + undo granular); the editor's
  // change flow then updates the buffer + docText.
  const applyFrontmatter = useCallback(
    (next: string) => {
      const old = docText
      if (next === old) return
      const min = Math.min(old.length, next.length)
      let p = 0
      while (p < min && old.charCodeAt(p) === next.charCodeAt(p)) p++
      let s = 0
      while (
        s < min - p &&
        old.charCodeAt(old.length - 1 - s) === next.charCodeAt(next.length - 1 - s)
      )
        s++
      editorHandle.current?.replaceRange(
        p,
        old.length - s,
        next.slice(p, next.length - s)
      )
    },
    [docText]
  )

  // Apply the pending rename: rewrite @{from}→@{to} across files (skipping any
  // open with unsaved edits), reload the touched buffers, and refresh the index.
  const applyRename = useCallback(async () => {
    const p = renamePrompt
    setRenamePrompt(null)
    if (!p) return
    const dirtyOpen = documents.openPaths.filter((path) => documents.dirtyPaths.has(path))
    const result = await window.api.renameMentions(p.from, p.to, dirtyOpen)
    for (const path of result.changed) {
      const r = await window.api.readFile(path)
      if (!r.ok) continue
      documents.reloadBuffer(path, r.text, r.mtimeMs)
    }
    projectData.refreshEntities()
    setNotice(
      result.skipped.length
        ? `Renamed ${result.count} mention(s). Skipped ${result.skipped.length} file(s) with unsaved edits — update those from Project Health.`
        : `Renamed ${result.count} mention(s) to @{${p.to}}.`
    )
  }, [renamePrompt, documents, projectData.refreshEntities])

  // Reload from disk (the dedicated toolbar button + View menu + command). Drops
  // the main-process index cache, re-reads the tree/entities, and re-reads every
  // open tab that has no unsaved edits so the editor reflects what's on disk —
  // the counterpart to the save-time conflict guard for external edits. Dirty
  // tabs are left untouched (their edits win until the user saves or discards).
  const reloadFromDisk = useCallback(async () => {
    await projectData.forceRefresh()
    const dirtyCount = documents.openPaths.filter((p) =>
      documents.dirtyPaths.has(p)
    ).length
    for (const path of documents.openPaths) {
      if (documents.dirtyPaths.has(path) || isImageFile(path)) continue
      const r = await window.api.readFile(path)
      if (r.ok) documents.reloadBuffer(path, r.text, r.mtimeMs)
    }
    setNotice(
      dirtyCount
        ? `Reloaded from disk — ${dirtyCount} tab(s) with unsaved edits left as-is.`
        : 'Reloaded from disk.'
    )
  }, [projectData.forceRefresh, documents, setNotice])

  // Export/compile: gather the ordered scenes into one clean manuscript (editorial
  // marks stripped, tracked changes accepted) and save it via a native dialog.
  const exportManuscript = useCallback(async () => {
    const result = await window.api.exportManuscript()
    if (!result.ok) {
      setNotice(result.error)
      return
    }
    const defaultName = `${project?.name ?? 'Manuscript'}.md`
    const saved = await window.api.exportSave(result.text, defaultName)
    if (saved.ok) {
      setNotice(
        `Exported ${result.scenes.length} scene(s), ${result.wordCount.toLocaleString()} words → ${saved.path}`
      )
    } else if (!saved.canceled) {
      setNotice(`Export failed: ${saved.error ?? 'unknown error'}`)
    }
  }, [project, setNotice])

  // Export to EPUB: one chapter per ordered scene, editorial marks stripped.
  const exportEpub = useCallback(async () => {
    const result = await window.api.exportEpub()
    if (result.ok) {
      setNotice(`Exported ${result.chapters} chapter(s) → ${result.path}`)
    } else if (!result.canceled) {
      setNotice(`EPUB export failed: ${result.error ?? 'unknown error'}`)
    }
  }, [setNotice])

  // Autosave (opt-in, M14): when on, save the active tab a beat after it goes
  // dirty. Whole-file write for now; explicit Cmd/Ctrl+S stays the default.
  useEffect(() => {
    const path = documents.activePath
    if (!settings.autosave || !path || !documents.dirtyPaths.has(path)) return
    // Don't autosave into an unresolved conflict — it would just re-trigger the
    // dialog every tick. Wait for the user to overwrite/reload first.
    if (documents.conflictTab) return
    const timer = setTimeout(() => void documents.saveTab(path), 1000)
    return () => clearTimeout(timer)
  }, [
    settings.autosave,
    documents.activePath,
    documents.dirtyPaths,
    documents.conflictTab,
    documents.saveTab
  ])

  // --- project open ---

  const applyOpenResult = useCallback(
    async (result: OpenProjectResult) => {
      if (!result.ok) {
        if (result.reason === 'cancelled') return
        if (result.reason === 'no-config') {
          setNotice(
            `No project.json in ${result.root} — not a SomedayWriter project yet.`
          )
        } else {
          setNotice(`Couldn't open project: ${result.message}`)
        }
        return
      }
      documents.reset()
      setProject(result.project)
      setNotice(null)
      settings.applyProjectConfig(result.project.config)
      // Load this project's pins + re-read tree + entities.
      await projectData.onOpen(result.project)
      // Keep the recent-projects list current (this open just reordered it).
      void window.api.getSettings().then((s) => setRecents(s.recentProjects))
    },
    [documents.reset, settings, projectData.onOpen]
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

  const clearRecents = useCallback(async () => {
    await window.api.updateSettings({ recentProjects: [] })
    setRecents([])
  }, [])

  // Save the Project Settings form: write project.json, then apply the new config
  // (theme/editor prefs) and re-read the tree (ignore globs may have changed).
  const saveProjectConfig = useCallback(
    async (next: ProjectConfig) => {
      const res = await window.api.writeProjectConfig(next)
      if (!res.ok) {
        setNotice(`Couldn't save settings: ${res.error}`)
        return
      }
      setProject(res.project)
      settings.applyProjectConfig(res.project.config)
      setSettingsOpen(false)
      await projectData.refreshTree()
      setNotice('Project settings saved.')
    },
    [settings, projectData.refreshTree]
  )

  // On first mount: load settings, restore the sidebar width, and reopen the
  // most recent project (falling back to the welcome + recents list if it fails).
  useEffect(() => {
    if (didInit.current) return
    didInit.current = true
    void (async () => {
      const loaded = await window.api.getSettings()
      setRecents(loaded.recentProjects)
      layout.hydrate(loaded)
      settings.hydrate(loaded)
      projectData.hydratePins(loaded)
      const last = loaded.recentProjects[0]
      if (last) await openRecent(last.path)
    })()
  }, [openRecent])

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
      const def = entityTypeMeta(entityType, projectData.entityTypes)
      const written = await window.api.writeFile(path, entityTemplate(def, name))
      // Fresh file, no base mtime passed → no conflict possible; only real errors.
      if (!written.ok && 'error' in written)
        setNotice(`Couldn't write template: ${written.error}`)
    }
    await projectData.refreshTree()
    if (fileName.endsWith('.md')) documents.openFile(path)
  }

  async function createFolderIn(dir: string, name: string) {
    const result = await window.api.createFolder(joinPath(dir, name))
    if (!result.ok) {
      setNotice(`Couldn't create folder: ${result.error}`)
      return
    }
    await projectData.refreshTree()
  }

  async function renameNode(node: TreeNode, newName: string) {
    const to = joinPath(parentDir(node.path), newName)
    if (to === node.path) return
    const result = await window.api.rename(node.path, to)
    if (!result.ok) {
      setNotice(`Couldn't rename: ${result.error}`)
      return
    }
    documents.remapOpenDocs(node.path, to)
    await projectData.refreshTree()
  }

  async function deleteNode(node: TreeNode) {
    const result = await window.api.remove(node.path)
    if (!result.ok) {
      setNotice(`Couldn't delete: ${result.error}`)
      return
    }
    documents.closeDocsUnder(node.path)
    await projectData.refreshTree()
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
    return projectData.tree ? (search(projectData.tree) ?? []) : []
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
    documents.remapOpenDocs(fromPath, to)
    await projectData.refreshTree()
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
      documents.remapOpenDocs(draggedPath, to)
    }
    await projectData.refreshTree()
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
    const { activePath, openPaths, saveTab, closeTab, switchTo, goBack, goForward } =
      documents
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
        panels.toggle('search')
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
    // ⌘[ / ⌘] back-forward (the Mac convention). CodeMirror binds these to
    // outdent/indent, so intercept in the capture phase — before the editor sees
    // them — and stop propagation so it never runs.
    const onNavKeys = (e: KeyboardEvent) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        e.stopPropagation()
        if (e.key === '[') navRef.current.back()
        else navRef.current.forward()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keydown', onNavKeys, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keydown', onNavKeys, true)
    }
  }, [])

  // Command registry (SPEC → command palette). The palette, menus, and
  // keybindings all draw from this one list — see useCommands. Built before the
  // no-project early return so the hook order is stable.
  const commands = useCommands({
    documents,
    panels,
    settings,
    entityTypes: projectData.entityTypes,
    editorHandle,
    newProject,
    openProject,
    exportManuscript,
    exportEpub,
    forceRefresh: reloadFromDisk,
    goToDefinition: projectData.goToDefinition,
    togglePin: projectData.togglePin,
    insertImageFromPicker,
    onNewFile: (entityType) =>
      projectData.tree &&
      setModal({ kind: 'newFile', dir: projectData.tree.path, entityType }),
    onNewFolder: () =>
      projectData.tree && setModal({ kind: 'newFolder', dir: projectData.tree.path }),
    onProjectSettings: () => setSettingsOpen(true)
  })

  if (!project) {
    return (
      <div className="welcome">
        <Logo size={56} className="welcome__logo" />
        <h1>SomedayWriter</h1>
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

  // The active file's position among its reading-ordered `.md` siblings, for the
  // Inspector — derived from the already-sorted tree (matches the explorer).
  const readingPosition = (() => {
    const activePath = documents.activePath
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
          <span className="menubar__brand">
            <Logo size={18} className="menubar__logo" />
            SomedayWriter
          </span>
          <span className="menubar__project" title={project.root}>
            {project.name}
          </span>
        </div>

        <nav className="menubar__menus">
          <button
            className="menubar__nav"
            title="Back (⌘[)"
            disabled={!documents.navState.back}
            onClick={documents.goBack}
          >
            ‹
          </button>
          <button
            className="menubar__nav"
            title="Forward (⌘])"
            disabled={!documents.navState.forward}
            onClick={documents.goForward}
          >
            ›
          </button>
          <span className="menubar__sep" role="separator" />
          <button className="menubar__item" onClick={() => void newProject()}>
            New…
          </button>
          <div className="menu">
            <button
              className={`menubar__item${menuOpen === 'open' ? ' menubar__item--open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen === 'open'}
              onClick={() => setMenuOpen((m) => (m === 'open' ? null : 'open'))}
            >
              Open ▾
            </button>
            {menuOpen === 'open' && (
              <>
                <div className="menu__backdrop" onClick={() => setMenuOpen(null)} />
                <div className="menu-pop" role="menu">
                  <button
                    className="menu-pop__row"
                    role="menuitem"
                    onClick={() => {
                      setMenuOpen(null)
                      void openProject()
                    }}
                  >
                    <span className="menu-pop__check" />
                    Open Project…
                  </button>
                  <div className="menu-pop__sep" />
                  <div className="menu-pop__label">Recent projects</div>
                  {recents.length === 0 ? (
                    <div className="menu-pop__row menu-pop__row--static">
                      <span className="menu-pop__check" />
                      No recent projects
                    </div>
                  ) : (
                    recents.slice(0, 8).map((r) => (
                      <button
                        key={r.path}
                        className="menu-pop__row"
                        role="menuitem"
                        title={r.path}
                        onClick={() => {
                          setMenuOpen(null)
                          void openRecent(r.path)
                        }}
                      >
                        <span className="menu-pop__check" />
                        {r.name}
                      </button>
                    ))
                  )}
                  {recents.length > 0 && (
                    <>
                      <div className="menu-pop__sep" />
                      <button
                        className="menu-pop__row"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(null)
                          void clearRecents()
                        }}
                      >
                        <span className="menu-pop__check" />
                        Clear recent projects
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
          <button
            className={`menubar__item${panels.open.search ? ' menubar__item--active' : ''}`}
            title="Search across all files (⌘/Ctrl+Shift+F)"
            onClick={() => panels.toggle('search')}
          >
            Find
          </button>
          <span className="menubar__sep" role="separator" />
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
                  <div className="menu-pop__label">This file</div>
                  {(
                    [
                      [
                        'Companion',
                        panels.open.companion,
                        () => panels.toggle('companion')
                      ],
                      ['Comments', panels.open.comments, () => panels.toggle('comments')],
                      [
                        'Debug info',
                        panels.open.inspector,
                        () => panels.toggle('inspector')
                      ],
                      [
                        'Frontmatter',
                        panels.open.frontmatter,
                        () => panels.toggle('frontmatter')
                      ],
                      ['__label__', false, () => {}],
                      [
                        'Project References',
                        panels.open.refs,
                        () => panels.toggle('refs')
                      ],
                      [
                        'Project Threads',
                        panels.open.threads,
                        () => panels.toggle('threads')
                      ],
                      [
                        'Threads Dashboard',
                        panels.open.braid,
                        () => panels.toggle('braid')
                      ],
                      [
                        'Project Health',
                        panels.open.health,
                        () => panels.toggle('health')
                      ]
                    ] as [string, boolean, () => void][]
                  ).map(([label, on, toggle]) =>
                    label === '__label__' ? (
                      <div key="proj-label" className="menu-pop__label">
                        Project
                      </div>
                    ) : (
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
                    )
                  )}

                  <div className="menu-pop__sep" />
                  <div className="menu-pop__label">Theme</div>
                  {[
                    ...BUILTIN_THEME_OPTIONS,
                    ...settings.availableThemes.map((t) => ({ id: t.id, name: t.name }))
                  ].map(({ id, name }) => (
                    <button
                      key={id}
                      className="menu-pop__row"
                      role="menuitemradio"
                      aria-checked={settings.theme === id}
                      onClick={() => {
                        settings.changeTheme(id)
                        setMenuOpen(null)
                      }}
                    >
                      <span className="menu-pop__check">
                        {settings.theme === id ? '✓' : ''}
                      </span>
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
                          className={`swatch${settings.accent === a ? ' swatch--on' : ''}`}
                          data-accent={a}
                          title={a}
                          onClick={() => settings.setAccentTo(a)}
                        />
                      ))}
                    </span>
                  </div>
                  <button
                    className="menu-pop__row"
                    role="menuitemcheckbox"
                    aria-checked={settings.focusMode}
                    onClick={() => {
                      settings.toggleFocus()
                      setMenuOpen(null)
                    }}
                  >
                    <span className="menu-pop__check">
                      {settings.focusMode ? '✓' : ''}
                    </span>
                    Focus mode
                  </button>

                  <div className="menu-pop__sep" />
                  <button
                    className="menu-pop__row"
                    onClick={() => {
                      setSettingsOpen(true)
                      setMenuOpen(null)
                    }}
                  >
                    <span className="menu-pop__check" />
                    Project settings…
                  </button>
                  <button
                    className="menu-pop__row"
                    onClick={() => {
                      void reloadFromDisk()
                      setMenuOpen(null)
                    }}
                  >
                    <span className="menu-pop__check" />
                    Reload from disk
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="menu">
            <button
              className={`menubar__item${menuOpen === 'editor' ? ' menubar__item--open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen === 'editor'}
              onClick={() => setMenuOpen((m) => (m === 'editor' ? null : 'editor'))}
            >
              Editor ▾
            </button>
            {menuOpen === 'editor' && (
              <>
                <div className="menu__backdrop" onClick={() => setMenuOpen(null)} />
                <div className="menu-pop" role="menu">
                  {(
                    [
                      ['Vim keys', settings.vim, settings.toggleVim],
                      ['Diagnostics', settings.diagnostics, settings.toggleDiagnostics],
                      ['Autosave', settings.autosave, settings.toggleAutosave]
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
                  {settings.vim && (
                    <button
                      className="menu-pop__row"
                      role="menuitemcheckbox"
                      aria-checked={settings.vimWrapMotion}
                      onClick={() => {
                        settings.toggleVimWrapMotion()
                        setMenuOpen(null)
                      }}
                    >
                      <span className="menu-pop__check">
                        {settings.vimWrapMotion ? '✓' : ''}
                      </span>
                      Wrapped-line motion (j/k)
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          <div className="menu">
            <button
              className={`menubar__item${menuOpen === 'export' ? ' menubar__item--open' : ''}`}
              aria-haspopup="menu"
              aria-expanded={menuOpen === 'export'}
              onClick={() => setMenuOpen((m) => (m === 'export' ? null : 'export'))}
            >
              Export ▾
            </button>
            {menuOpen === 'export' && (
              <>
                <div className="menu__backdrop" onClick={() => setMenuOpen(null)} />
                <div className="menu-pop" role="menu">
                  {(
                    [
                      ['Manuscript (Markdown)…', exportManuscript],
                      ['EPUB…', exportEpub]
                    ] as [string, () => void][]
                  ).map(([label, run]) => (
                    <button
                      key={label}
                      className="menu-pop__row"
                      role="menuitem"
                      onClick={() => {
                        setMenuOpen(null)
                        void run()
                      }}
                    >
                      <span className="menu-pop__check" />
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <button
            className={`menubar__item${panels.open.help ? ' menubar__item--active' : ''}`}
            title="Help — features, shortcuts, and connecting Claude"
            onClick={() => panels.set('help', true)}
          >
            Help
          </button>
        </nav>

        <div className="menubar__right">
          <SaveStatus
            hasFile={documents.activePath != null && !isImageFile(documents.activePath)}
            dirty={documents.dirty}
            unsavedCount={documents.dirtyPaths.size}
            autosave={settings.autosave}
            onSave={() => {
              if (documents.activePath) void documents.saveTab(documents.activePath)
            }}
          />
          <button
            className="menubar__item menubar__item--icon"
            title="Reload from disk — pick up edits made outside the app (⌘/Ctrl+P → Reload)"
            aria-label="Reload from disk"
            onClick={() => void reloadFromDisk()}
          >
            <Icon name="reload" size={15} />
          </button>
          <span className="menubar__sep" role="separator" />
          <button
            className="ptog ptog--left"
            data-on={!layout.sidebarHidden}
            title="Toggle explorer"
            onClick={layout.toggleSidebar}
          >
            <span className="ptog__bar" />
          </button>
          <button
            className="ptog ptog--right"
            data-on={panels.open.companion}
            title="Toggle companion panel"
            onClick={() => panels.toggle('companion')}
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
        style={{ '--panel-width': `${layout.panelWidth}px` } as CSSProperties}
      >
        {!layout.sidebarHidden && (
          <>
            <aside className="sidebar" style={{ width: layout.sidebarWidth }}>
              <div className="sidebar__header">
                <span className="sidebar__title">{project.name}</span>
                <div className="sidebar__actions">
                  <button
                    className="icon-btn icon-btn--action"
                    aria-label="New file"
                    onClick={() =>
                      projectData.tree &&
                      setModal({ kind: 'newFile', dir: projectData.tree.path })
                    }
                  >
                    <Icon name="file-plus" size={17} />
                    <span className="icon-btn__tip">New file</span>
                  </button>
                  <button
                    className="icon-btn icon-btn--action"
                    aria-label="New folder"
                    onClick={() =>
                      projectData.tree &&
                      setModal({ kind: 'newFolder', dir: projectData.tree.path })
                    }
                  >
                    <Icon name="folder-plus" size={17} />
                    <span className="icon-btn__tip">New folder</span>
                  </button>
                </div>
              </div>
              {projectData.tree ? (
                <FileTree
                  root={projectData.tree}
                  activePath={documents.activePath}
                  entityIcons={projectData.entityIcons}
                  pinned={projectData.explorerPins}
                  onTogglePin={projectData.toggleExplorerPin}
                  onSelect={(path) =>
                    path === joinPath(project.root, 'project.json')
                      ? setSettingsOpen(true)
                      : documents.openFile(path)
                  }
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
              onMouseDown={layout.startSidebarResize}
            />
          </>
        )}

        <main className="main" style={editorStyle}>
          {panels.open.braid ? (
            <BraidView
              sceneOrder={projectData.projectFiles.map((f) => f.path)}
              refreshKey={inspectorRefresh}
              onOpen={(path) => {
                documents.openFile(path)
                panels.set('braid', false)
              }}
              onClose={() => panels.set('braid', false)}
            />
          ) : (
            <>
              {documents.openPaths.length > 0 && (
                <TabStrip
                  openPaths={documents.openPaths}
                  activePath={documents.activePath}
                  dirtyPaths={documents.dirtyPaths}
                  onSelect={documents.switchTo}
                  onClose={documents.closeTab}
                  onReorder={documents.reorderTabs}
                />
              )}
              {documents.doc && !settings.vim && (
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
                    title="Help"
                    onClick={() => panels.set('help', true)}
                  >
                    ?
                  </button>
                </div>
              )}
              {documents.activeImageUrl ? (
                <ImageView
                  url={documents.activeImageUrl}
                  name={basename(documents.activePath ?? '')}
                />
              ) : documents.doc ? (
                <Editor
                  doc={documents.doc}
                  vimEnabled={settings.vim}
                  vimWrapMotion={settings.vimWrapMotion}
                  diagnosticsEnabled={settings.diagnostics}
                  analysis={projectData.analysis}
                  onStatus={setStatus}
                  onVimMode={setVimMode}
                  onDocChange={handleDocChange}
                  revealTarget={documents.revealTarget}
                  onGoToDefinition={projectData.goToDefinition}
                  onResolveMention={(lineText, column) =>
                    mentionRangeAt(lineText, column, projectData.entities)
                  }
                  handleRef={editorHandle}
                  assetDir={documents.assetDir}
                  onImageDropped={onImageDropped}
                />
              ) : (
                <div className="placeholder">Select a file to start editing.</div>
              )}
            </>
          )}
        </main>

        {(panels.open.search ||
          panels.open.refs ||
          panels.open.inspector ||
          panels.open.companion ||
          panels.open.threads) && (
          <div
            className="divider divider--panel"
            role="separator"
            title="Drag to resize"
            onMouseDown={layout.startPanelResize}
          />
        )}

        {panels.open.search && (
          <ProjectSearch
            onClose={() => panels.set('search', false)}
            onOpenMatch={(path, line, column) =>
              documents.openFile(path, { line, column })
            }
          />
        )}

        {panels.open.refs && (
          <ReferencesPanel
            entities={projectData.entities}
            entityTypes={projectData.entityTypes}
            onClose={() => panels.set('refs', false)}
            onOpenRef={(path, line, column, length) =>
              documents.openFile(path, { line, column, endColumn: column + length })
            }
            onOpenProfile={(entity) => documents.openFile(entity.path)}
          />
        )}

        {panels.open.inspector && (
          <InspectorPanel
            path={documents.activePath}
            readingPosition={readingPosition}
            refreshKey={inspectorRefresh}
            entityTypes={projectData.entityTypes}
            onClose={() => panels.set('inspector', false)}
          />
        )}

        {panels.open.companion && (
          <CompanionPanel
            activePath={documents.activePath}
            pinnedPaths={projectData.pinnedPaths}
            onTogglePin={projectData.togglePin}
            onOpenFull={(path) => documents.openFile(path)}
            refreshKey={inspectorRefresh}
            entityTypes={projectData.entityTypes}
            onClose={() => panels.set('companion', false)}
          />
        )}

        {panels.open.threads && (
          <ThreadsPanel
            onOpenBeat={(path) => documents.openFile(path)}
            refreshKey={inspectorRefresh}
            onClose={() => panels.set('threads', false)}
          />
        )}

        {panels.open.comments && (
          <CommentsPanel
            text={docText}
            onJump={(line, column) => documents.fireReveal({ line, column })}
            onClose={() => panels.set('comments', false)}
          />
        )}

        {panels.open.frontmatter && (
          <FrontmatterPanel
            path={documents.activePath}
            text={docText}
            onApply={applyFrontmatter}
            entities={projectData.entities}
            entityTypes={projectData.entityTypes}
            onClose={() => panels.set('frontmatter', false)}
          />
        )}

        {panels.open.health && (
          <HealthPanel
            refreshKey={inspectorRefresh}
            onOpen={(path, line, column, length) =>
              documents.openFile(path, { line, column, endColumn: column + length })
            }
            onClose={() => panels.set('health', false)}
          />
        )}

        {/* Panel rail — file-specific panels up top, then a divider, then the
            project-wide ("Project …") panels. */}
        <nav className="rail" aria-label="Panels">
          {(
            [
              [
                'Companion',
                'book-open',
                panels.open.companion,
                () => panels.toggle('companion')
              ],
              [
                'Comments',
                'comment',
                panels.open.comments,
                () => panels.toggle('comments')
              ],
              [
                'Debug info',
                'info',
                panels.open.inspector,
                () => panels.toggle('inspector')
              ],
              [
                'Frontmatter',
                'tag',
                panels.open.frontmatter,
                () => panels.toggle('frontmatter')
              ],
              null,
              [
                'Project References',
                'link',
                panels.open.refs,
                () => panels.toggle('refs')
              ],
              [
                'Project Threads',
                'thread',
                panels.open.threads,
                () => panels.toggle('threads')
              ],
              [
                'Project Health',
                'activity',
                panels.open.health,
                () => panels.toggle('health')
              ]
            ] as ([string, string, boolean, () => void] | null)[]
          ).map((item, i) =>
            item === null ? (
              <div key={`rail-div-${i}`} className="rail__divider" role="separator" />
            ) : (
              (([label, icon, on, toggle]) => (
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
              ))(item)
            )
          )}
        </nav>
      </div>

      <footer className="statusbar">
        {settings.vim && vimMode && (
          <span className="statusbar__vim" data-vim-mode={vimMode}>
            {vimMode.toUpperCase()}
          </span>
        )}
        <span>
          {documents.activePath ? basename(documents.activePath) : 'No file open'}
          {documents.dirty && <span className="statusbar__dot" title="Unsaved changes" />}
        </span>
        <span>{status.words} words</span>
        <span>
          Ln {status.cursor.line}, Col {status.cursor.column}
        </span>
        <span className="statusbar__hint">
          {notice ?? (
            <>
              {documents.dirty ? 'Unsaved' : 'Saved'} ·{' '}
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
            ...projectData.entityTypes.map((t) => ({
              value: t.type,
              label: `${t.icon} ${t.label}`
            }))
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

      {documents.closingTab && (
        <UnsavedChangesModal
          filename={basename(documents.closingTab)}
          onSave={() => void documents.resolveClosing('save')}
          onDiscard={() => void documents.resolveClosing('discard')}
          onCancel={documents.cancelClosing}
        />
      )}

      {documents.conflictTab && (
        <ConflictModal
          filename={basename(documents.conflictTab)}
          onOverwrite={() => void documents.resolveConflict('overwrite')}
          onReload={() => void documents.resolveConflict('reload')}
          onCancel={documents.cancelConflict}
        />
      )}

      {quickInput !== null && (
        <QuickInput
          files={projectData.projectFiles}
          commands={commands}
          initialQuery={quickInput}
          recentFiles={documents.recentFiles}
          recentCommands={recentCommands}
          onRunCommand={(id) =>
            setRecentCommands((prev) =>
              [id, ...prev.filter((x) => x !== id)].slice(0, 20)
            )
          }
          onClose={() => setQuickInput(null)}
          // Reveal line 1 so the editor takes focus — land in the file ready to
          // type, not back in the quick-input.
          onOpenFile={(path) => documents.openFile(path, { line: 1, column: 1 })}
        />
      )}

      {panels.open.help && (
        <Help
          projectRoot={project.root}
          projectName={project.name}
          onClose={() => panels.set('help', false)}
        />
      )}

      {settingsOpen && (
        <ProjectSettings
          config={project.config}
          themeOptions={[
            ...BUILTIN_THEME_OPTIONS,
            ...settings.availableThemes.map((t) => ({ id: t.id, name: t.name }))
          ]}
          onSave={(next) => void saveProjectConfig(next)}
          onCancel={() => setSettingsOpen(false)}
        />
      )}

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
