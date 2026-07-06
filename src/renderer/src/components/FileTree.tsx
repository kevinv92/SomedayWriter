import { useEffect, useState } from 'react'
import type { TreeNode } from '@shared/types'
import { parentDir } from '../lib/paths'

interface FileTreeProps {
  /** The project root node; its children are rendered (the root itself is the
   * sidebar header, so it isn't shown as a row here). */
  root: TreeNode
  activePath: string | null
  onSelect: (path: string) => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRename: (node: TreeNode) => void
  onDelete: (node: TreeNode) => void
}

/** v1 edits Markdown only; other files show greyed and aren't selectable. */
function isEditable(node: TreeNode): boolean {
  return node.type === 'file' && node.name.endsWith('.md')
}

/** Where a new file/folder created "on" this node should land. */
function targetDir(node: TreeNode): string {
  return node.type === 'directory' ? node.path : parentDir(node.path)
}

interface RowProps {
  node: TreeNode
  activePath: string | null
  onSelect: (path: string) => void
  onContext: (node: TreeNode, x: number, y: number) => void
}

function FileRow({ node, activePath, onSelect, onContext }: RowProps) {
  const editable = isEditable(node)
  const active = node.path === activePath
  return (
    <button
      className={`tree-file${active ? ' tree-file--active' : ''}${
        editable ? '' : ' tree-file--disabled'
      }`}
      disabled={!editable}
      title={editable ? node.name : 'Only Markdown (.md) files are editable in v1'}
      onClick={() => onSelect(node.path)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContext(node, e.clientX, e.clientY)
      }}
    >
      {node.name}
    </button>
  )
}

function DirRow({ node, activePath, onSelect, onContext }: RowProps) {
  const [open, setOpen] = useState(true)
  return (
    <div className="tree-dir">
      <button
        className="tree-dir__label"
        onClick={() => setOpen((o) => !o)}
        onContextMenu={(e) => {
          e.preventDefault()
          onContext(node, e.clientX, e.clientY)
        }}
      >
        <span className="tree-dir__caret">{open ? '▾' : '▸'}</span>
        {node.name}
      </button>
      {open && node.children && node.children.length > 0 && (
        <div className="tree-dir__children">
          {node.children.map((child) => (
            <TreeItem
              key={child.path}
              node={child}
              activePath={activePath}
              onSelect={onSelect}
              onContext={onContext}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TreeItem(props: RowProps) {
  return props.node.type === 'directory' ? <DirRow {...props} /> : <FileRow {...props} />
}

interface Menu {
  node: TreeNode
  x: number
  y: number
}

export function FileTree({
  root,
  activePath,
  onSelect,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete
}: FileTreeProps) {
  const [menu, setMenu] = useState<Menu | null>(null)

  // Dismiss the context menu on any outside click, scroll, or Escape.
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const children = root.children ?? []
  const openContext = (node: TreeNode, x: number, y: number) => setMenu({ node, x, y })
  const run = (fn: () => void) => {
    fn()
    setMenu(null)
  }

  return (
    <div className="tree">
      {children.length === 0 ? (
        <p className="tree-empty">This project has no files yet.</p>
      ) : (
        children.map((child) => (
          <TreeItem
            key={child.path}
            node={child}
            activePath={activePath}
            onSelect={onSelect}
            onContext={openContext}
          />
        ))
      )}

      {menu && (
        <div
          className="context-menu"
          style={{ left: menu.x, top: menu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => run(() => onNewFile(targetDir(menu.node)))}>
            New File
          </button>
          <button onClick={() => run(() => onNewFolder(targetDir(menu.node)))}>
            New Folder
          </button>
          <div className="context-menu__sep" />
          <button onClick={() => run(() => onRename(menu.node))}>Rename…</button>
          <button
            className="context-menu__danger"
            onClick={() => run(() => onDelete(menu.node))}
          >
            Delete…
          </button>
        </div>
      )}
    </div>
  )
}
