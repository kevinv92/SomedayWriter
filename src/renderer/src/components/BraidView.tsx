import { useEffect, useMemo, useRef, useState } from 'react'
import type { Thread } from '@shared/types'

interface BraidViewProps {
  /** Manuscript scene paths in reading order — the x-axis source. Only threaded
   * scenes become columns for now; passing the full manuscript here later is all
   * it takes to widen the braid to every scene. */
  sceneOrder: string[]
  /** Open a beat's scene (also closes the braid — the board is a navigator). */
  onOpen: (path: string) => void
  /** Bumped on save / reload so the model re-reads. */
  refreshKey: number
  onClose: () => void
}

// Board geometry (SVG user units; pan/zoom scales all of it).
const LANE_H = 60
const COL_W = 130
const PAD_LEFT = 150 // thread-label gutter
const PAD_TOP = 56 // column-header row
const NODE_R = 7

const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), hi)
const short = (s: string, n = 16) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/** Thread braid visualiser — read side (Phase 5, M10). One lane per thread; the
 * x-axis is manuscript reading order (or a single thread's own order). Beats are
 * nodes; scenes on multiple threads draw a vertical crossing. The whole board is
 * an SVG group under one pan/zoom transform (drag to pan, wheel to zoom), so it
 * scales crisply and can grow to the full manuscript. Clicking a beat navigates
 * to that scene. */
export function BraidView({ sceneOrder, onOpen, refreshKey, onClose }: BraidViewProps) {
  const [threads, setThreads] = useState<Thread[]>([])
  const [loaded, setLoaded] = useState(false)
  // Order mode: null = manuscript order; otherwise the tag of the followed thread.
  const [follow, setFollow] = useState<string | null>(null)
  const [view, setView] = useState({ tx: 0, ty: 0, k: 1 })
  const pan = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

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

  const orderIndex = useMemo(() => {
    const m = new Map<string, number>()
    sceneOrder.forEach((p, i) => m.set(p, i))
    return m
  }, [sceneOrder])

  const titleOf = useMemo(() => {
    const m = new Map<string, string>()
    for (const t of threads)
      for (const b of t.beats) if (!m.has(b.path)) m.set(b.path, b.title)
    return m
  }, [threads])

  // The x-axis: which scene sits in which column.
  const columns = useMemo(() => {
    if (follow) {
      const t = threads.find((x) => x.tag === follow)
      if (t) return t.beats.map((b) => b.path) // already in thread order
    }
    const paths = new Set<string>()
    for (const t of threads) for (const b of t.beats) paths.add(b.path)
    return [...paths].sort(
      (a, b) => (orderIndex.get(a) ?? 1e9) - (orderIndex.get(b) ?? 1e9)
    )
  }, [threads, follow, orderIndex])

  const colOf = useMemo(() => {
    const m = new Map<string, number>()
    columns.forEach((p, i) => m.set(p, i))
    return m
  }, [columns])

  const colX = (path: string) => {
    const i = colOf.get(path)
    return i == null ? null : PAD_LEFT + i * COL_W + COL_W / 2
  }
  const laneY = (row: number) => PAD_TOP + row * LANE_H + LANE_H / 2

  // Crossings: for each column, the rows present there; link min→max when 2+.
  const crossings = columns
    .map((path) => {
      const rows: number[] = []
      threads.forEach((t, row) => {
        if (t.beats.some((b) => b.path === path)) rows.push(row)
      })
      return { path, rows }
    })
    .filter((c) => c.rows.length > 1)

  // --- pan / zoom ---
  const onPointerDown = (e: React.MouseEvent) => {
    // Don't let the drag start a native text-selection / element drag — that's
    // what could end in a drop that navigates the window and blanks the app.
    e.preventDefault()
    pan.current = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty }
  }
  const onPointerMove = (e: React.MouseEvent) => {
    if (!pan.current) return
    setView((v) => ({
      ...v,
      tx: pan.current!.tx + (e.clientX - pan.current!.x),
      ty: pan.current!.ty + (e.clientY - pan.current!.y)
    }))
  }
  const endPan = () => {
    pan.current = null
  }
  const onWheel = (e: React.WheelEvent) => {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top
    setView((v) => {
      const k = clamp(v.k * (1 - e.deltaY * 0.0015), 0.3, 3)
      const scale = k / v.k
      return { k, tx: cx - (cx - v.tx) * scale, ty: cy - (cy - v.ty) * scale }
    })
  }

  return (
    <div className="braid">
      <div className="braid__header">
        <span className="braid__title">Project Threads · Timeline</span>
        <div className="braid__order">
          <span className="braid__order-label">Order:</span>
          <button
            className={`braid__chip${follow === null ? ' braid__chip--on' : ''}`}
            onClick={() => setFollow(null)}
          >
            Manuscript
          </button>
          {threads.map((t) => (
            <button
              key={t.tag}
              className={`braid__chip${follow === t.tag ? ' braid__chip--on' : ''}`}
              onClick={() => setFollow(t.tag)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <div className="braid__actions">
          <button
            className="icon-btn"
            title="Reset view"
            onClick={() => setView({ tx: 0, ty: 0, k: 1 })}
          >
            ⤢
          </button>
          <button className="icon-btn" title="Close" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>

      {loaded && threads.length === 0 ? (
        <div className="braid__empty">
          No threads yet. Tag scenes with <code>threads: [name]</code>.
        </div>
      ) : (
        <svg
          ref={svgRef}
          className="braid__svg"
          onMouseDown={onPointerDown}
          onMouseMove={onPointerMove}
          onMouseUp={endPan}
          onMouseLeave={endPan}
          onWheel={onWheel}
        >
          <g transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
            {/* column headers */}
            {columns.map((path, i) => (
              <text
                key={path}
                className="braid-col"
                x={PAD_LEFT + i * COL_W + COL_W / 2}
                y={PAD_TOP - 20}
                textAnchor="middle"
              >
                {short(titleOf.get(path) ?? '')}
              </text>
            ))}

            {/* crossings (behind nodes) */}
            {crossings.map((c) => {
              const x = colX(c.path)!
              return (
                <line
                  key={c.path}
                  className="braid-cross"
                  x1={x}
                  y1={laneY(Math.min(...c.rows))}
                  x2={x}
                  y2={laneY(Math.max(...c.rows))}
                />
              )
            })}

            {/* lanes + nodes */}
            {threads.map((t, row) => {
              const dim = follow !== null && follow !== t.tag
              const xs = t.beats
                .map((b) => colX(b.path))
                .filter((x): x is number => x != null)
              const y = laneY(row)
              return (
                <g key={t.tag} opacity={dim ? 0.28 : 1}>
                  {/* thread label */}
                  <rect
                    className="braid-swatch"
                    x={12}
                    y={y - 6}
                    width={12}
                    height={12}
                    rx={3}
                    fill={t.color ?? 'var(--muted)'}
                  />
                  <text className="braid-name" x={32} y={y + 4}>
                    {short(t.name, 15)}
                  </text>
                  {/* lane segment through this thread's beats */}
                  {xs.length > 0 && (
                    <line
                      className="braid-lane"
                      x1={Math.min(...xs)}
                      y1={y}
                      x2={Math.max(...xs)}
                      y2={y}
                      stroke={t.color ?? 'var(--muted)'}
                    />
                  )}
                  {/* beats */}
                  {t.beats.map((b) => {
                    const x = colX(b.path)
                    if (x == null) return null
                    return (
                      <circle
                        key={b.path}
                        className="braid-node"
                        cx={x}
                        cy={y}
                        r={NODE_R}
                        fill={t.color ?? 'var(--muted)'}
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={() => onOpen(b.path)}
                      >
                        <title>{b.summary ? `${b.title} — ${b.summary}` : b.title}</title>
                      </circle>
                    )
                  })}
                </g>
              )
            })}
          </g>
        </svg>
      )}
    </div>
  )
}
