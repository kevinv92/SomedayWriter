import { useEffect, useState } from 'react'
import type { EntityRef, NeglectedThread } from '@shared/types'
import { basename } from '../lib/paths'
import { Icon } from './Icon'

interface HealthPanelProps {
  /** Bumped on save / entity change so the check re-runs. */
  refreshKey: number
  /** Jump to a dead reference (path + 1-based line/column, highlight length). */
  onOpen: (path: string, line: number, column: number, length: number) => void
  onClose: () => void
}

/**
 * Project Health panel (Phase 9). Checks: **dead references** — every
 * `@{surface}` whose surface no longer resolves to an entity — and **neglected
 * threads** (Threads v2, #2) — a thread that went quiet without ever closing.
 * Click a row to jump. More checks land in a later health/lint phase.
 */
export function HealthPanel({ refreshKey, onOpen, onClose }: HealthPanelProps) {
  const [dead, setDead] = useState<EntityRef[] | null>(null)
  const [neglected, setNeglected] = useState<NeglectedThread[] | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.api.storyHealth().then((d) => {
      if (!cancelled) setDead(d)
    })
    void window.api.storyNeglectedThreads().then((n) => {
      if (!cancelled) setNeglected(n)
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Project Health</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="search-panel__results">
        <div className="health-section">
          Dead references{dead && dead.length > 0 ? ` · ${dead.length}` : ''}
        </div>
        {dead === null ? (
          <div className="search-panel__status">Checking…</div>
        ) : dead.length === 0 ? (
          <div className="search-panel__status">
            No dead references — every mention resolves.
          </div>
        ) : (
          dead.map((ref, i) => (
            <button
              key={`${ref.path}:${ref.line}:${i}`}
              className="comment-item comment-item--dead"
              onClick={() =>
                onOpen(ref.path, ref.line, ref.column, ref.surface.length + 3)
              }
            >
              <span className="comment-item__icon">
                <Icon name="info" size={14} />
              </span>
              <span className="comment-item__body">
                <span className="comment-item__text">{`@{${ref.surface}}`}</span>
                <span className="comment-item__span">
                  {basename(ref.path)} · {ref.preview}
                </span>
              </span>
              <span className="comment-item__line">{ref.line}</span>
            </button>
          ))
        )}

        <div className="health-section">
          Neglected threads
          {neglected && neglected.length > 0 ? ` · ${neglected.length}` : ''}
        </div>
        {neglected === null ? (
          <div className="search-panel__status">Checking…</div>
        ) : neglected.length === 0 ? (
          <div className="search-panel__status">
            No neglected threads — every open arc is still active.
          </div>
        ) : (
          neglected.map((n) => (
            <button
              key={n.tag}
              className="comment-item comment-item--dead"
              title={`Jump to the last beat of ${n.name}`}
              onClick={() => onOpen(n.path, 1, 1, 0)}
            >
              <span className="comment-item__icon">
                <Icon name="activity" size={14} />
              </span>
              <span className="comment-item__body">
                <span className="comment-item__text">{n.name}</span>
                <span className="comment-item__span">
                  {n.dangling ? 'opened, never closed · ' : ''}silent {n.scenes} scene
                  {n.scenes === 1 ? '' : 's'} / ~{n.words.toLocaleString()} words since “
                  {n.since}”
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
