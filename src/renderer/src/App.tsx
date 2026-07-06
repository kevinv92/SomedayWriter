import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Editor, type EditorStatus } from './components/Editor'
import { FileTree } from './components/FileTree'
import type { EditorDoc } from './editor/types'
import type { ProjectMeta, TreeNode } from '@shared/types'

type ActiveDoc = { path: string; text: string }

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export default function App() {
  const [project, setProject] = useState<ProjectMeta | null>(null)
  const [tree, setTree] = useState<TreeNode | null>(null)
  const [activeDoc, setActiveDoc] = useState<ActiveDoc | null>(null)
  const [dirty, setDirty] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
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
    const tree = await window.api.readTree()
    setProject(result.project)
    setTree(tree)
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
        <p>Open a folder that contains a project.json to start writing.</p>
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
          {tree ? (
            <FileTree
              root={tree}
              activePath={activeDoc?.path ?? null}
              onSelect={(path) => void selectFile(path)}
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
    </div>
  )
}
