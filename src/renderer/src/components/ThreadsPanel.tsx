import { useEffect, useMemo, useState } from 'react'
import type { Thread } from '@shared/types'
import { basename } from '../lib/paths'

interface ThreadsPanelProps {
  /** Open a beat (scene) at its file. */
  onOpenBeat: (path: string) => void
  /** Bumped after a save / entity change so the model re-reads from disk. */
  refreshKey: number
  onClose: () => void
}

/** Threads panel (Phase 5, M9). A read view of the `ThreadProvider` model: each
 * thread's beats in thread order (per-thread order, else manuscript order), with
 * identity (name/colour/description) from an optional `type: thread` entity file.
 * Beats shared by several threads are flagged as intersections. This is the
 * text precursor to the M10 braid visualiser. */
export function ThreadsPanel({ onOpenBeat, refreshKey, onClose }: ThreadsPanelProps) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loaded, setLoaded] = useState(false)
  // Collapsed threads (default: all expanded — there are usually few).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    let cancelled = false
    void window.api.storyThreads().then((t) => {
      if (cancelled) return
      setThreads(t)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  // How many threads each scene sits on → beats on 2+ threads are intersections.
  const beatThreadCount = useMemo(() => {
    const counts = new Map<string, number>()
    for (const thread of threads) {
      for (const beat of thread.beats) {
        counts.set(beat.path, (counts.get(beat.path) ?? 0) + 1)
      }
    }
    return counts
  }, [threads])

  const toggle = (tag: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Threads</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="search-panel__results">
        {loaded && threads.length === 0 && (
          <div className="search-panel__status">
            No threads yet. Tag a scene with <code>threads: [name]</code> in its
            frontmatter.
          </div>
        )}

        {threads.map((thread) => {
          const isOpen = !collapsed.has(thread.tag)
          return (
            <div key={thread.tag} className="thread">
              <button className="thread__head" onClick={() => toggle(thread.tag)}>
                <span className="thread__caret">{isOpen ? '▾' : '▸'}</span>
                <span
                  className="thread__swatch"
                  style={{ background: thread.color ?? 'var(--muted)' }}
                />
                <span className="thread__name">{thread.name}</span>
                <span className="thread__count">
                  {thread.beats.length} scene{thread.beats.length === 1 ? '' : 's'}
                </span>
              </button>

              {isOpen && thread.description && (
                <div className="thread__desc">{thread.description}</div>
              )}

              {isOpen &&
                thread.beats.map((beat, i) => (
                  <button
                    key={beat.path}
                    className="thread-beat"
                    onClick={() => onOpenBeat(beat.path)}
                    title={beat.path}
                  >
                    <span className="thread-beat__n">{i + 1}</span>
                    <span className="thread-beat__title">
                      {beat.title || basename(beat.path)}
                    </span>
                    {(beatThreadCount.get(beat.path) ?? 0) > 1 && (
                      <span className="thread-beat__x" title="On multiple threads">
                        ⋈
                      </span>
                    )}
                  </button>
                ))}

              {isOpen && thread.beats.length === 0 && (
                <div className="thread__empty">No scenes tagged yet.</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
