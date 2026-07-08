import { useEffect, useMemo, useRef, useState } from 'react'
import type { TreeNode } from '@shared/types'
import { parentDir } from '../lib/paths'
import { Icon } from './Icon'

interface FileTreeProps {
  /** The project root node; its children are rendered (the root itself is the
   * sidebar header, so it isn't shown as a row here). */
  root: TreeNode
  activePath: string | null
  /** Icon per profile file (Phase 7, M18), keyed by path — badges a location vs.
   * an item in the tree. Absent for non-entity files. */
  entityIcons?: Map<string, string>
  onSelect: (path: string) => void
  onNewFile: (dir: string) => void
  onNewFolder: (dir: string) => void
  onRename: (node: TreeNode) => void
  onDelete: (node: TreeNode) => void
  /** Drag `draggedPath` and drop it on `target` — a folder (move) or a file
   * (reorder). App decides which and writes the change (M6). */
  onDrop: (draggedPath: string, target: TreeNode) => void
}

/** v1 edits Markdown only; other files show greyed and aren't selectable. Only
 * Markdown files are draggable (they're the scenes that carry `order`). */
function isEditable(node: TreeNode): boolean {
  return node.type === 'file' && node.name.endsWith('.md')
}

/** Where a new file/folder created "on" this node should land. */
function targetDir(node: TreeNode): string {
  return node.type === 'directory' ? node.path : parentDir(node.path)
}

type FlatRow = { node: TreeNode; depth: number }
type Menu = { node: TreeNode; x: number; y: number }

export function FileTree({
  root,
  activePath,
  entityIcons,
  onSelect,
  onNewFile,
  onNewFolder,
  onRename,
  onDelete,
  onDrop
}: FileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [focused, setFocused] = useState<string | null>(null)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [dragPath, setDragPath] = useState<string | null>(null)
  const [dropPath, setDropPath] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Flatten the tree into the visible rows in display order (a collapsed folder
  // hides its descendants). Drives both rendering and keyboard nav.
  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = []
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        out.push({ node, depth })
        if (
          node.type === 'directory' &&
          !collapsed.has(node.path) &&
          node.children?.length
        ) {
          walk(node.children, depth + 1)
        }
      }
    }
    walk(root.children ?? [], 0)
    return out
  }, [root, collapsed])

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

  // Keep the keyboard-focused row scrolled into view.
  useEffect(() => {
    if (!focused) return
    containerRef.current
      ?.querySelector(`[data-path="${CSS.escape(focused)}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [focused])

  const toggle = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const activate = (node: TreeNode) => {
    if (node.type === 'directory') toggle(node.path)
    else if (isEditable(node)) onSelect(node.path)
  }

  // Arrow-key navigation over the flattened rows (M12).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (menu) return
    const idx = rows.findIndex((r) => r.node.path === focused)
    const cur = idx >= 0 ? rows[idx] : null
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const next = rows[idx < 0 ? 0 : Math.min(idx + 1, rows.length - 1)]
      if (next) setFocused(next.node.path)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      const next = rows[idx <= 0 ? 0 : idx - 1]
      if (next) setFocused(next.node.path)
    } else if (e.key === 'ArrowRight' && cur?.node.type === 'directory') {
      e.preventDefault()
      if (collapsed.has(cur.node.path)) toggle(cur.node.path)
      else if (rows[idx + 1]?.depth > cur.depth) setFocused(rows[idx + 1].node.path)
    } else if (e.key === 'ArrowLeft' && cur) {
      e.preventDefault()
      if (cur.node.type === 'directory' && !collapsed.has(cur.node.path)) {
        toggle(cur.node.path)
      } else {
        for (let i = idx - 1; i >= 0; i--) {
          if (rows[i].depth < cur.depth) {
            setFocused(rows[i].node.path)
            break
          }
        }
      }
    } else if (e.key === 'Enter' && cur) {
      e.preventDefault()
      activate(cur.node)
    }
  }

  const openContext = (node: TreeNode, e: React.MouseEvent) => {
    e.preventDefault()
    setMenu({ node, x: e.clientX, y: e.clientY })
  }
  const run = (fn: () => void) => {
    fn()
    setMenu(null)
  }
  const onDropNode = (node: TreeNode) => {
    if (dragPath && dragPath !== node.path) onDrop(dragPath, node)
    setDragPath(null)
    setDropPath(null)
  }

  return (
    <div
      className="tree"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDragEnd={() => setDropPath(null)}
    >
      {rows.length === 0 ? (
        <p className="tree-empty">This project has no files yet.</p>
      ) : (
        rows.map(({ node, depth }) => {
          const focusCls = node.path === focused ? ' tree-focused' : ''
          const dropCls = node.path === dropPath ? ' tree-drop' : ''
          if (node.type === 'directory') {
            return (
              <button
                key={node.path}
                data-path={node.path}
                className={`tree-dir__label${focusCls}${dropCls}`}
                style={{ paddingLeft: `${depth * 0.85 + 0.4}rem` }}
                onClick={() => {
                  toggle(node.path)
                  setFocused(node.path)
                }}
                onContextMenu={(e) => openContext(node, e)}
                onDragOver={(e) => {
                  e.preventDefault()
                  setDropPath(node.path)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  onDropNode(node)
                }}
              >
                <span className="tree-dir__caret">
                  <Icon
                    name={collapsed.has(node.path) ? 'chevron-right' : 'chevron-down'}
                    size={13}
                  />
                </span>
                {node.name}
              </button>
            )
          }
          const editable = isEditable(node)
          const icon = entityIcons?.get(node.path)
          return (
            <button
              key={node.path}
              data-path={node.path}
              className={`tree-file${node.path === activePath ? ' tree-file--active' : ''}${
                editable ? '' : ' tree-file--disabled'
              }${focusCls}${dropCls}`}
              style={{ paddingLeft: `${depth * 0.85 + 1.3}rem` }}
              disabled={!editable}
              draggable={editable}
              title={
                editable ? node.name : 'Only Markdown (.md) files are editable in v1'
              }
              onClick={() => {
                onSelect(node.path)
                setFocused(node.path)
              }}
              onContextMenu={(e) => openContext(node, e)}
              onDragStart={() => setDragPath(node.path)}
              onDragOver={(e) => {
                e.preventDefault()
                setDropPath(node.path)
              }}
              onDrop={(e) => {
                e.preventDefault()
                onDropNode(node)
              }}
            >
              {icon && (
                <span className="tree-file__icon">
                  <Icon name={icon} size={14} />
                </span>
              )}
              {node.name}
            </button>
          )
        })
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
