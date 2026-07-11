import { useEffect, useState, type ReactNode } from 'react'
import type { AuditAction, AuditEntry } from '@shared/types'
import { Icon } from './Icon'

interface AuditLogPanelProps {
  /** Bumped on save / entity change so the log re-reads. */
  refreshKey: number
  /** Open the file an entry refers to (project-relative path). */
  onOpen: (relPath: string) => void
  onClose: () => void
}

const ACTION_LABEL: Record<AuditAction, string> = {
  save: 'Saved',
  overwrite: 'Overwrote',
  create: 'Created',
  delete: 'Deleted',
  reorder: 'Reordered',
  'rename-refactor': 'Renamed refs'
}

function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function fmtBytes(n: number): string {
  return n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`
}

/**
 * Activity Log — the project's append-only audit trail (`.somedaywriter/audit.jsonl`).
 * Every write the app made, newest first, with the byte size before → after so a
 * shrunken file (possible data loss) stands out. Read-only; click a row to open
 * the file. A local-first safety net: if a save ever looks wrong, it's traceable.
 */
export function AuditLogPanel({
  refreshKey,
  onOpen,
  onClose
}: AuditLogPanelProps): ReactNode {
  const [entries, setEntries] = useState<AuditEntry[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.readAuditLog(500).then((e) => {
      if (!cancelled) setEntries(e)
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Activity Log</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="search-panel__results">
        {entries === null ? (
          <div className="search-panel__status">Reading…</div>
        ) : entries.length === 0 ? (
          <div className="search-panel__status">
            No activity logged yet. Every write the app makes to this project is recorded
            here.
          </div>
        ) : (
          entries.map((e, i) => {
            const removed = e.action === 'delete'
            const shrank = !removed && e.prevBytes != null && e.bytes < e.prevBytes
            return (
              <button
                key={`${e.ts}-${i}`}
                className={`audit-row${shrank || removed ? ' audit-row--warn' : ''}`}
                title={removed ? 'File deleted' : 'Open this file'}
                onClick={() => {
                  if (!removed) onOpen(e.path)
                }}
              >
                <div className="audit-row__top">
                  <span className="audit-row__action">{ACTION_LABEL[e.action]}</span>
                  <span className="audit-row__time">{fmtTime(e.ts)}</span>
                </div>
                <div className="audit-row__path">{e.path}</div>
                <div className="audit-row__size">
                  {removed
                    ? e.prevBytes != null
                      ? `was ${fmtBytes(e.prevBytes)}`
                      : ''
                    : e.prevBytes != null
                      ? `${fmtBytes(e.prevBytes)} → ${fmtBytes(e.bytes)}${
                          shrank ? ` (−${fmtBytes(e.prevBytes - e.bytes)})` : ''
                        }`
                      : fmtBytes(e.bytes)}
                </div>
              </button>
            )
          })
        )}
      </div>
    </div>
  )
}
