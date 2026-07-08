import { useEffect, useState } from 'react'
import { Icon } from './Icon'
import type { FileInspection } from '@shared/types'
import { entityTypeMeta, type ResolvedEntityType } from '@shared/entity-types'
import { basename } from '../lib/paths'

interface InspectorPanelProps {
  /** Active file to inspect, or null when no tab is open. */
  path: string | null
  /** The file's 1-based position among reading-ordered siblings (from the tree). */
  readingPosition: { index: number; total: number } | null
  /** Bumped by the app after a save so the pane re-reads the file from disk. */
  refreshKey: number
  /** Registered entity types (M18), for the mention type badges. */
  entityTypes: ResolvedEntityType[]
  onClose: () => void
}

const SOURCE_LABEL: Record<FileInspection['title']['source'], string> = {
  frontmatter: 'frontmatter title',
  heading: 'first heading',
  filename: 'filename'
}

/** Inspector / file-details pane (Phase 5, M8b). A read-only mirror of what
 * `StoryIndex` + the frontmatter parser see for the active file — title source,
 * order, threads, mentions, word count, and (the key debug value) parse
 * warnings. Reads the same model the app uses (`story:inspect`), never parsing
 * independently; reflects the file on disk, so it updates after a save. */
export function InspectorPanel({
  path,
  readingPosition,
  refreshKey,
  entityTypes,
  onClose
}: InspectorPanelProps) {
  // Track which path a result is for, so a stale response (or a path switch) is
  // ignored and we never call setState synchronously in the effect body.
  const [state, setState] = useState<{
    forPath: string
    result: FileInspection | null
  } | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    void window.api.inspectFile(path).then((result) => {
      if (!cancelled) setState({ forPath: path, result })
    })
    return () => {
      cancelled = true
    }
  }, [path, refreshKey])

  // Only trust state that matches the current path (else it's mid-fetch/stale).
  const settled = state && state.forPath === path ? state : null
  const data = settled?.result ?? null

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Inspector</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="search-panel__results">
        {!path && <div className="search-panel__status">No file open.</div>}
        {path && !settled && <div className="search-panel__status">Reading…</div>}
        {settled && !settled.result && (
          <div className="search-panel__status">Couldn’t read this file.</div>
        )}

        {data && (
          <>
            {data.warnings.length > 0 && (
              <div className="inspector-warnings">
                {data.warnings.map((warning, i) => (
                  <div key={i} className="inspector-warning">
                    ⚠ {warning}
                  </div>
                ))}
              </div>
            )}

            <div className="inspector-field">
              <div className="inspector-field__label">Title</div>
              <div className="inspector-field__value">
                {data.title.value}
                <span className="inspector-field__note">
                  from {SOURCE_LABEL[data.title.source]}
                </span>
              </div>
            </div>

            <div className="inspector-field">
              <div className="inspector-field__label">Order</div>
              <div className="inspector-field__value">
                {data.order ?? '—'}
                {readingPosition && (
                  <span className="inspector-field__note">
                    {readingPosition.index} of {readingPosition.total} in folder
                  </span>
                )}
              </div>
            </div>

            <div className="inspector-field">
              <div className="inspector-field__label">Words</div>
              <div className="inspector-field__value">{data.wordCount}</div>
            </div>

            <div className="inspector-field">
              <div className="inspector-field__label">Threads</div>
              <div className="inspector-field__value">
                {data.threads.length === 0 ? (
                  <span className="inspector-field__empty">none</span>
                ) : (
                  <div className="inspector-tags">
                    {data.threads.map((thread) => (
                      <span key={thread} className="inspector-tag">
                        {thread}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="inspector-field">
              <div className="inspector-field__label">
                Mentions
                {data.mentions.length > 0 && ` (${data.mentions.length})`}
              </div>
              <div className="inspector-field__value">
                {data.mentions.length === 0 ? (
                  <span className="inspector-field__empty">none detected</span>
                ) : (
                  data.mentions.map((mention) => (
                    <div key={mention.name} className="inspector-mention">
                      <span className="inspector-mention__name">{mention.name}</span>
                      <span className="inspector-mention__type">
                        <Icon
                          name={entityTypeMeta(mention.type, entityTypes).iconName}
                          size={13}
                        />{' '}
                        {mention.type}
                      </span>
                      <span className="inspector-mention__count">×{mention.count}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="inspector-file">{basename(data.path)}</div>
          </>
        )}
      </div>
    </div>
  )
}
