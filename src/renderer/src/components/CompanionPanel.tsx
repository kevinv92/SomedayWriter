import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'
import type { CompanionEntry, Thread } from '@shared/types'
import { entityTypeMeta, type ResolvedEntityType } from '@shared/entity-types'

/** Render inline markdown to nodes: `@{mention}` → tinted surface, `**bold**`,
 *  and `*italic*` / `_italic_`. The braces/asterisks are editor syntax, not
 *  something to read in the companion. */
const INLINE = /@\{([^}]+)\}|\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_/g
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let key = 0
  let m: RegExpExecArray | null
  INLINE.lastIndex = 0
  while ((m = INLINE.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] != null)
      out.push(
        <span key={key++} className="companion-men">
          {m[1]}
        </span>
      )
    else if (m[2] != null) out.push(<strong key={key++}>{m[2]}</strong>)
    else out.push(<em key={key++}>{m[3] ?? m[4]}</em>)
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/** Render an entity body as clean prose: drop the leading `# Heading` (redundant
 *  with the entry title), then walk lines into paragraphs, sub-headings, and
 *  bullet lists — inline markup rendered, never shown raw. */
function renderEntryBody(raw: string): ReactNode {
  const stripped = raw.replace(/^\s*#{1,6}\s+.*(?:\r?\n)+/, '')
  const blocks: ReactNode[] = []
  let para: string[] = []
  let list: string[] = []
  let k = 0
  const flushPara = (): void => {
    if (para.length) {
      blocks.push(<p key={k++}>{renderInline(para.join(' '))}</p>)
      para = []
    }
  }
  const flushList = (): void => {
    if (list.length) {
      const items = list
      blocks.push(
        <ul key={k++}>
          {items.map((li, i) => (
            <li key={i}>{renderInline(li)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }
  for (const line of stripped.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) {
      flushPara()
      flushList()
      continue
    }
    const heading = t.match(/^#{1,6}\s+(.*)$/)
    const bullet = t.match(/^[-*]\s+(.*)$/)
    if (heading) {
      flushPara()
      flushList()
      blocks.push(
        <div key={k++} className="companion-body__sub">
          {renderInline(heading[1])}
        </div>
      )
    } else if (bullet) {
      flushPara()
      list.push(bullet[1])
    } else {
      flushList()
      para.push(t)
    }
  }
  flushPara()
  flushList()
  if (!blocks.length) return <span className="companion-empty">(empty)</span>
  return blocks
}

interface CompanionPanelProps {
  /** The file whose scene drives auto-follow, or null when no tab is open. */
  activePath: string | null
  /** Paths the writer has pinned (per-project, from app settings). */
  pinnedPaths: string[]
  /** Pin/unpin a reference. */
  onTogglePin: (path: string) => void
  /** Promote a reference to a real editor tab ("open full"). */
  onOpenFull: (path: string) => void
  /** Bumped after a save / entity change so the pane re-reads from disk. */
  refreshKey: number
  /** Registered entity types (M18), for the entry type badges. */
  entityTypes: ResolvedEntityType[]
  onClose: () => void
}

/** Reference companion pane (Phase 5, M8d). Keeps the story bible at hand while
 * drafting: a **Pinned** zone of frozen anchors plus an **In this scene** zone
 * that auto-follows the active file (entities detected in it). Read-first —
 * entries collapse to a summary, expand in place, and "open full" promotes to a
 * tab. The cardinal rule: auto-follow changes which entries are listed but never
 * disturbs the one you're reading — expand state is keyed by path and survives
 * repopulation, and each expanded body remembers its scroll. */
export function CompanionPanel({
  activePath,
  pinnedPaths,
  onTogglePin,
  onOpenFull,
  refreshKey,
  entityTypes,
  onClose
}: CompanionPanelProps) {
  // Scene set, tagged with the path it's for (so a stale/no-file result is ignored
  // without a synchronous setState in the effect).
  const [sceneState, setSceneState] = useState<{
    forPath: string
    entries: CompanionEntry[]
  } | null>(null)
  const [pinned, setPinned] = useState<CompanionEntry[]>([])
  // If the active file is a `type: thread` entity, its thread (with beats) — so the
  // Companion shows the arc (Threads v2, #7; first case of companion-by-type).
  // Tagged with the path it's for (like sceneState) so a stale result is ignored
  // without a synchronous setState in the effect.
  const [threadState, setThreadState] = useState<{
    forPath: string
    thread: Thread | null
  } | null>(null)
  // Which entries are open — keyed by path, so scene repopulation never collapses
  // what the writer is reading.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Per-entry body scroll, restored when an entry is re-expanded ("keep scroll").
  const scrollMemory = useRef(new Map<string, number>())

  useEffect(() => {
    if (!activePath) return
    let cancelled = false
    void window.api.sceneRefs(activePath).then((entries) => {
      if (!cancelled) setSceneState({ forPath: activePath, entries })
    })
    return () => {
      cancelled = true
    }
  }, [activePath, refreshKey])

  useEffect(() => {
    let cancelled = false
    void Promise.all(pinnedPaths.map((p) => window.api.loadRef(p))).then((list) => {
      if (!cancelled) setPinned(list.filter((e): e is CompanionEntry => e !== null))
    })
    return () => {
      cancelled = true
    }
  }, [pinnedPaths, refreshKey])

  // When the open file is a thread's own page, load that thread so we can show
  // its arc. (A thread entity file's path matches a Thread's `path`.)
  useEffect(() => {
    if (!activePath) return
    let cancelled = false
    void window.api.storyThreads().then((threads) => {
      if (!cancelled)
        setThreadState({
          forPath: activePath,
          thread: threads.find((t) => t.path === activePath) ?? null
        })
    })
    return () => {
      cancelled = true
    }
  }, [activePath, refreshKey])

  const threadHere =
    threadState && threadState.forPath === activePath ? threadState.thread : null
  const pinnedSet = useMemo(() => new Set(pinnedPaths), [pinnedPaths])
  // Scene entries not already pinned (pinned ones show only in the Pinned zone).
  const scene =
    sceneState && sceneState.forPath === activePath
      ? sceneState.entries.filter((e) => !pinnedSet.has(e.path))
      : []

  const toggleExpand = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })

  const renderEntry = (entry: CompanionEntry) => {
    const isOpen = expanded.has(entry.path)
    const isPinned = pinnedSet.has(entry.path)
    return (
      <article
        key={entry.path}
        className={`companion-entry${isOpen ? ' companion-entry--open' : ''}`}
      >
        <div className="companion-entry__head">
          <button
            className="companion-entry__toggle"
            onClick={() => toggleExpand(entry.path)}
            title={isOpen ? 'Collapse' : 'Expand'}
          >
            <span className="companion-entry__ico">
              <Icon name={entityTypeMeta(entry.type, entityTypes).iconName} size={15} />
            </span>
            <span className="companion-entry__name">{entry.title}</span>
            <span className="companion-entry__chip">{entry.type}</span>
            {entry.count != null && (
              <span className="companion-entry__count">×{entry.count}</span>
            )}
          </button>
          <div className="companion-entry__acts">
            <button
              className={`companion-act${isPinned ? ' companion-act--on' : ''}`}
              title={isPinned ? 'Unpin' : 'Pin'}
              onClick={() => onTogglePin(entry.path)}
            >
              <Icon name="pin" size={14} />
            </button>
            <button
              className="companion-act"
              title="Open as tab"
              onClick={() => onOpenFull(entry.path)}
            >
              ↗
            </button>
          </div>
        </div>
        {isOpen ? (
          <div
            className="companion-body"
            ref={(el) => {
              if (el) el.scrollTop = scrollMemory.current.get(entry.path) ?? 0
            }}
            onScroll={(e) =>
              scrollMemory.current.set(entry.path, e.currentTarget.scrollTop)
            }
          >
            {renderEntryBody(entry.body ?? '')}
          </div>
        ) : (
          entry.summary && (
            <div className="companion-summary">{renderInline(entry.summary)}</div>
          )
        )}
      </article>
    )
  }

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Companion</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <div className="search-panel__results">
        {threadHere && (
          <>
            <div className="companion-zone">
              <Icon name="spool" size={12} /> Thread — {threadHere.name}
            </div>
            <div className="companion-arc__stats">
              {(() => {
                const bs = threadHere.beats
                const closed = bs.some((b) => b.state === 'closes')
                const opened = bs.some((b) => b.state === 'opens')
                const status = closed
                  ? 'resolved'
                  : opened
                    ? 'open · unresolved'
                    : 'active'
                return `${bs.length} beat${bs.length === 1 ? '' : 's'} · ${status}`
              })()}
            </div>
            {threadHere.beats.length === 0 ? (
              <div className="companion-hint">No scenes on this thread yet.</div>
            ) : (
              threadHere.beats.map((b) => (
                <button
                  key={b.path}
                  className="companion-beat"
                  onClick={() => onOpenFull(b.path)}
                  title={`Open ${b.title}`}
                >
                  <span className="companion-beat__title">{b.title}</span>
                  {b.state !== 'touches' && (
                    <span
                      className={`companion-beat__state companion-beat__state--${b.state}`}
                    >
                      {b.state}
                    </span>
                  )}
                  {b.intensity && (
                    <span className="companion-beat__intensity">{b.intensity}</span>
                  )}
                  {b.summary && (
                    <span className="companion-beat__summary">{b.summary}</span>
                  )}
                </button>
              ))
            )}
          </>
        )}

        <div className="companion-zone">
          <Icon name="pin" size={12} /> Pinned
        </div>
        {pinned.length === 0 ? (
          <div className="companion-hint">
            Pin an entity or a note to keep it here across scenes.
          </div>
        ) : (
          pinned.map(renderEntry)
        )}

        <div className="companion-zone">In this scene</div>
        {!activePath ? (
          <div className="companion-hint">No file open.</div>
        ) : scene.length === 0 ? (
          <div className="companion-hint">Nothing detected here yet.</div>
        ) : (
          scene.map(renderEntry)
        )}
      </div>
    </div>
  )
}
