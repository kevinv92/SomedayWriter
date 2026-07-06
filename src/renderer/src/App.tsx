import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorStatus } from './components/Editor'
import { FileTree } from './components/FileTree'
import { ConfirmModal, PromptModal } from './components/Modal'
import type { EditorDoc } from './editor/types'
import type { ProjectMeta, TreeNode } from '@shared/types'
import { basename, isInsideDir, joinPath, parentDir } from './lib/paths'

type ActiveDoc = { path: string; text: string }

type ModalState =
  | { kind: 'newFile'; dir: string }
  | { kind: 'newFolder'; dir: string }
  | { kind: 'rename'; node: TreeNode }
  | { kind: 'delete'; node: TreeNode }
  | null

export default function App() {
  const [project, setProject] = useState<ProjectMeta | null>(null)
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [modal, setModal] = useState<ModalState>(null)
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

  const doc = useMemo<EditorDoc | null>(
    () => (activeDoc ? { uri: activeDoc.path, text: activeDoc.text } : null),
    [activeDoc]
  )

  const refreshTree = async () => {
    setTree(await window.api.readTree())
  }

  const openProject = useCallback(async () => {
    const result = await window.api.openProject()
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
    // Honour the project's default diagnostics setting on open.
    setDiagnostics(result.project.config.editor?.diagnostics ?? false)
  }, [])

  const selectFile = useCallback(async (path: string) => {
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
  }, [])

  const handleDocChange = useCallback((text: string) => {
    currentTextRef.current = text
    setDirty(text !== savedTextRef.current)
  }, [])

  const save = useCallback(async () => {
    if (!activeDoc) return
    const text = currentTextRef.current
    const result = await window.api.writeFile(activeDoc.path, text)
    if (!result.ok) {
      setNotice(`Couldn't save: ${result.error}`)
      return
    }
    savedTextRef.current = text
    setDirty(false)
  }, [activeDoc])

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
    if (fileName.endsWith('.md')) await selectFile(path)
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
    // Keep the open doc pointed at its new path (rename doesn't touch content, so
    // carry the live editor text across the reload rather than the stale copy).
    if (activeDoc?.path === node.path) {
      setActiveDoc({ path: to, text: currentTextRef.current })
    } else if (activeDoc && isInsideDir(activeDoc.path, node.path)) {
      const moved = to + activeDoc.path.slice(node.path.length)
      setActiveDoc({ path: moved, text: currentTextRef.current })
    }
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

  // Cmd/Ctrl+S saves. Kept in a ref so the listener binds once yet always calls
  // the current `save` (which closes over the active doc).
  const saveRef = useRef(save)
  useEffect(() => {
    saveRef.current = save
  }, [save])
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault()
        void saveRef.current()
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
        {notice && <p className="welcome__notice">{notice}</p>}
      </div>
    )
  }

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
        <aside className="sidebar">
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
              onSelect={(path) => void selectFile(path)}
              onNewFile={(dir) => setModal({ kind: 'newFile', dir })}
              onNewFolder={(dir) => setModal({ kind: 'newFolder', dir })}
              onRename={(node) => setModal({ kind: 'rename', node })}
              onDelete={(node) => setModal({ kind: 'delete', node })}
            />
          ) : (
            <p className="tree-empty">Loading…</p>
          )}
        </aside>

        <main className="main">
          {doc ? (
            <Editor
              doc={doc}
              vimEnabled={vim}
              diagnosticsEnabled={diagnostics}
              onStatus={setStatus}
              onDocChange={handleDocChange}
            />
          ) : (
            <div className="placeholder">Select a file to start editing.</div>
          )}
        </main>
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
    </div>
  )
}
