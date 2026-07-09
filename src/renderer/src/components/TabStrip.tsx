import { useRef, useState } from 'react'
import { basename } from '../lib/paths'

interface TabStripProps {
  openPaths: string[]
  activePath: string | null
  dirtyPaths: Set<string>
  onSelect: (path: string) => void
  onClose: (path: string) => void
  /** Move `from` to `to`'s slot (drag-to-reorder). */
  onReorder: (from: string, to: string) => void
}

/**
 * The open-tab strip. Tabs are **drag-to-reorder** (HTML5 DnD): dragging a tab
 * over another live-reorders it into that slot; the drag state is local here so
 * App doesn't carry it.
 */
export function TabStrip({
  openPaths,
  activePath,
  dirtyPaths,
  onSelect,
  onClose,
  onReorder
}: TabStripProps) {
  // The dragged path lives in a ref so `onDragOver` reads it synchronously (a
  // state read would lag a render behind `onDragStart`); the state mirror only
  // drives the dimming style.
  const draggingRef = useRef<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const startDrag = (p: string): void => {
    draggingRef.current = p
    setDragging(p)
  }
  const endDrag = (): void => {
    draggingRef.current = null
    setDragging(null)
  }

  return (
    <div className="tabstrip">
      {openPaths.map((p) => (
        <div
          key={p}
          className={`tabstrip__tab${p === activePath ? ' tabstrip__tab--active' : ''}${
            p === dragging ? ' tabstrip__tab--dragging' : ''
          }`}
          title={p}
          draggable
          onClick={() => onSelect(p)}
          onDragStart={(e) => {
            startDrag(p)
            e.dataTransfer.effectAllowed = 'move'
            // Firefox needs data set for a drag to start.
            e.dataTransfer.setData('text/plain', p)
          }}
          onDragOver={(e) => {
            const from = draggingRef.current
            if (!from || from === p) return
            e.preventDefault()
            e.dataTransfer.dropEffect = 'move'
            // Live-reorder: slot the dragged tab where we're hovering.
            onReorder(from, p)
          }}
          onDragEnd={endDrag}
        >
          <span className="tabstrip__name">{basename(p)}</span>
          {dirtyPaths.has(p) && <span className="tabstrip__dot" />}
          <button
            className="tabstrip__close"
            title="Close (⌘/Ctrl+W)"
            onClick={(e) => {
              e.stopPropagation()
              onClose(p)
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  )
}
