import { useState } from 'react'
import type { TreeNode } from '@shared/types'

interface FileTreeProps {
  /** The project root node; its children are rendered (the root itself is the
   * sidebar header, so it isn't shown as a row here). */
  root: TreeNode
  activePath: string | null
  onSelect: (path: string) => void
}

/** v1 edits Markdown only; other files show greyed and aren't selectable. */
function isEditable(node: TreeNode): boolean {
  return node.type === 'file' && node.name.endsWith('.md')
}

function FileRow({ node, activePath, onSelect }: NodeProps) {
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
    >
      {node.name}
    </button>
  )
}

function DirRow({ node, activePath, onSelect }: NodeProps) {
  const [open, setOpen] = useState(true)
  return (
    <div className="tree-dir">
      <button className="tree-dir__label" onClick={() => setOpen((o) => !o)}>
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
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface NodeProps {
  node: TreeNode
  activePath: string | null
  onSelect: (path: string) => void
}

function TreeItem(props: NodeProps) {
  return props.node.type === 'directory' ? <DirRow {...props} /> : <FileRow {...props} />
}

export function FileTree({ root, activePath, onSelect }: FileTreeProps) {
  const children = root.children ?? []
  if (children.length === 0) {
    return <p className="tree-empty">This project has no files yet.</p>
  }
  return (
    <div className="tree">
      {children.map((child) => (
        <TreeItem
          key={child.path}
          node={child}
          activePath={activePath}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
}
