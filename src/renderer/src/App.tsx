import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties
} from 'react'
import { Editor, type EditorStatus } from './components/Editor'
import { FileTree } from './components/FileTree'
import { ConfirmModal, PromptModal, UnsavedChangesModal } from './components/Modal'
import { ProjectSearch } from './components/ProjectSearch'
import { AnalysisService } from './analysis/analysis-service'
import { createMentionProvider } from './analysis/providers/mention-provider'
import { createSpellProvider } from './analysis/providers/spell-provider'
import type { EditorDoc } from './editor/types'
import type {
  OpenProjectResult,
  ProjectMeta,
  RecentProject,
  TreeNode
} from '@shared/types'
import { basename, isInsideDir, joinPath, parentDir } from './lib/paths'

type ActiveDoc = { path: string; text: string }

type Reveal = { line: number; column: number }

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
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [pendingOpen, setPendingOpen] = useState<{
    path: string
    reveal: Reveal | null
  } | null>(null)
  const [revealTarget, setRevealTarget] = useState<(Reveal & { nonce: number }) | null>(
    null
  )
  const [vim, setVim] = useState(false)
  const [diagnostics, setDiagnostics] = useState(false)
  const [status, setStatus] = useState<EditorStatus>({
    words: 0,
    cursor: { line: 1, column: 1 }
  })

  // Latest editor text and the last-saved baseline, kept in refs so per-keystroke
  // edits don't re-render App — only the derived `dirty` flag does.
  const savedTextRef = useRef('')
  const currentTextRef = useRef('')
  const revealNonce = useRef(0)

  const doc = useMemo<EditorDoc | null>(
    () => (activeDoc ? { uri: activeDoc.path, text: activeDoc.text } : null),
    [activeDoc]
  )

  // The analysis facade + its providers (Phase 4). Created once; the editor
  // talks only to this, never to a provider (SPEC seam).
  const analysis = useMemo(() => {
    const service = new AnalysisService()
    service.register(createMentionProvider())
    service.register(createSpellProvider())
    return service
  }, [])
  useEffect(() => () => analysis.dispose(), [analysis])

  const refreshTree = async () => {
    setTree(await window.api.readTree())
  }

  // Apply an open-project result (shared by the dialog and open-recent flows).
  const applyOpenResult = useCallback(async (result: OpenProjectResult) => {
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
    setProject(result.project)
    setTree(nextTree)
    setActiveDoc(null)
    setDirty(false)
    setNotice(null)
    setDiagnostics(result.project.config.editor?.diagnostics ?? false)
  }, [])

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
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(Math.min(Math.max(startWidth + ev.clientX - startX, 160), 480))
      }
      const onUp = () => {
        window.removeEventListener('mousemove', onMove)
        window.removeEventListener('mouseup', onUp)
      }
      window.addEventListener('mousemove', onMove)
      window.addEventListener('mouseup', onUp)
    },
    [sidebarWidth]
  )

  // Load recent projects for the welcome screen (only while none is open).
  useEffect(() => {
    if (project) return
    void (async () => {
      const settings = await window.api.getSettings()
      setRecents(settings.recentProjects)
    })()
  }, [project])

  // Load a file into the editor (optionally revealing a line). No dirty guard —
  // callers go through `requestOpen` for that.
  const loadFile = useCallback(async (path: string, reveal?: Reveal) => {
    const result = await window.api.readFile(path)
    if (!result.ok) {
      setNotice(`Couldn't open file: ${result.error}`)
      return
    }
    savedTextRef.current = result.text
    currentTextRef.current = result.text
    setActiveDoc({ path, text: result.text })
    setDirty(false)
    setNotice(null)
    if (reveal) {
      revealNonce.current += 1
      setRevealTarget({ ...reveal, nonce: revealNonce.current })
    }
  }, [])

  // Open a file, but guard unsaved edits in the current one (edit-safety fix).
  const requestOpen = useCallback(
    (path: string, reveal?: Reveal) => {
      // Already open: just reveal — never re-read from disk (would drop edits).
      if (activeDoc?.path === path) {
        if (reveal) {
          revealNonce.current += 1
          setRevealTarget({ ...reveal, nonce: revealNonce.current })
        }
        return
      }
      if (activeDoc && dirty) {
        setPendingOpen({ path, reveal: reveal ?? null })
        return
      }
      void loadFile(path, reveal)
    },
    [activeDoc, dirty, loadFile]
  )

  const handleDocChange = useCallback((text: string) => {
    currentTextRef.current = text
    setDirty(text !== savedTextRef.current)
  }, [])

  const save = useCallback(async (): Promise<boolean> => {
    if (!activeDoc) return true
    const text = currentTextRef.current
    const result = await window.api.writeFile(activeDoc.path, text)
    if (!result.ok) {
      setNotice(`Couldn't save: ${result.error}`)
      return false
    }
    savedTextRef.current = text
    setDirty(false)
    return true
  }, [activeDoc])

  const resolvePending = async (action: 'save' | 'discard') => {
    const pending = pendingOpen
    if (!pending) return
    if (action === 'save' && !(await save())) {
      setPendingOpen(null) // save failed — keep edits, don't switch
      return
    }
    setPendingOpen(null)
    void loadFile(pending.path, pending.reveal ?? undefined)
  }

  // Point the open doc at a moved/renamed path (content unchanged on disk).
  const remapActiveDoc = (from: string, to: string) => {
    if (activeDoc?.path === from) {
      setActiveDoc({ path: to, text: currentTextRef.current })
    } else if (activeDoc && isInsideDir(activeDoc.path, from)) {
      setActiveDoc({
        path: to + activeDoc.path.slice(from.length),
        text: currentTextRef.current
      })
    }
  }

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
    if (fileName.endsWith('.md')) requestOpen(path)
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
    remapActiveDoc(node.path, to)
    await refreshTree()
  }

  async function deleteNode(node: TreeNode) {
    const result = await window.api.remove(node.path)
    if (!result.ok) {
      setNotice(`Couldn't delete: ${result.error}`)
      return
    }
    if (
      activeDoc &&
      (activeDoc.path === node.path || isInsideDir(activeDoc.path, node.path))
    ) {
      setActiveDoc(null)
      setDirty(false)
    }
    await refreshTree()
  }

  // --- manuscript order + move (M6) ---

  /** The children array that contains `path` (its siblings), or []. */
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
    remapActiveDoc(fromPath, to)
    await refreshTree()
  }

  /** Drop `draggedPath` on `target`: onto a folder → move in; onto an .md file →
   * place right after it (reorder), moving into that folder first if needed. */
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
    // Ensure the neighbours have orders; renormalize the run if not.
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
      remapActiveDoc(draggedPath, to)
    }
    await refreshTree()
  }

  // Cmd/Ctrl+S saves; Cmd/Ctrl+Shift+F toggles project search. (Plain Cmd/Ctrl+F
  // is handled inside the editor by CodeMirror.) `save` is read via a ref so the
  // listener binds once yet always calls the current closure.
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && !e.shiftKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
      } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setSearchOpen((v) => !v)
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

  // Editor typography from config, applied as CSS vars on the editor pane (no
  // CodeMirror rebuild). Each falls back to the prose default.
  const ed = project.config.editor
  const measureVar =
    ed?.measure === 'full'
      ? 'none'
      : typeof ed?.measure === 'number'
        ? `${ed.measure}rem`
        : '46rem'
  const fontVar = fontStack(ed?.font)
  const editorStyle = {
    '--editor-measure': measureVar,
    '--editor-font': fontVar,
    '--editor-font-size': ed?.fontSize ? `${ed.fontSize}px` : '16px',
    '--editor-line-height': ed?.lineHeight ? String(ed.lineHeight) : '1.7'
  } as CSSProperties

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
        </div>
      </header>

      <div className="body">
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
              activePath={activeDoc?.path ?? null}
              onSelect={(path) => requestOpen(path)}
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
          {doc ? (
            <Editor
              doc={doc}
              vimEnabled={vim}
              diagnosticsEnabled={diagnostics}
              analysis={analysis}
              onStatus={setStatus}
              onDocChange={handleDocChange}
              revealTarget={revealTarget}
            />
          ) : (
            <div className="placeholder">Select a file to start editing.</div>
          )}
        </main>

        {searchOpen && (
          <ProjectSearch
            onClose={() => setSearchOpen(false)}
            onOpenMatch={(path, line, column) => requestOpen(path, { line, column })}
          />
        )}
      </div>

      <footer className="statusbar">
        <span>
          {activeDoc ? basename(activeDoc.path) : 'No file open'}
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

      {pendingOpen && (
        <UnsavedChangesModal
          filename={activeDoc ? basename(activeDoc.path) : 'this file'}
          onSave={() => void resolvePending('save')}
          onDiscard={() => void resolvePending('discard')}
          onCancel={() => setPendingOpen(null)}
        />
      )}
    </div>
  )
}
