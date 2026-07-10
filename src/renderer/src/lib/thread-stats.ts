import type { ManuscriptScene, Thread } from '@shared/types'

/** A thread's resolution status, inferred from its beats' `state` (Threads v2, #5).
 *  `resolved` — has a `closes` beat. `open` — opened but never closed (a dangling
 *  thread). `active` — running, no explicit open/close. */
export type ThreadStatus = 'resolved' | 'open' | 'active'

/** One row of the Threads dashboard (Threads v2, #6): a thread's at-a-glance
 *  stats, derived purely from the thread model + the manuscript scene spine. */
export type ThreadStat = {
  tag: string
  name: string
  color: string | null
  /** The thread's own entity file, if one exists (where a click should land). */
  path: string | null
  /** How many scenes sit on this thread. */
  beats: number
  /** Approximate words across the thread's scenes. */
  words: number
  /** First and last appearance in manuscript reading order (empty if unplaced). */
  firstTitle: string
  lastTitle: string
  status: ThreadStatus
  /** Opened but never closed. */
  dangling: boolean
  /** Manuscript scenes since the thread's last beat (0 if resolved/unplaced). */
  silent: number
}

const orderKey = (b: {
  manuscriptOrder: number | null
  threadOrder: number | null
}): number => b.manuscriptOrder ?? b.threadOrder ?? Infinity

/**
 * Compute per-thread dashboard stats from the thread model and the ordered scene
 * spine. Pure and self-contained so it's unit-testable without any IPC: word
 * counts come from matching each beat's `path` against `scenes`, and `silent` is
 * the raw count of scenes after the thread's last placed beat (0 once resolved).
 */
export function threadStats(threads: Thread[], scenes: ManuscriptScene[]): ThreadStat[] {
  const wordsByPath = new Map(scenes.map((s) => [s.path, s.words]))
  const ordered = [...scenes].sort((a, b) => a.order - b.order)

  return threads.map((t) => {
    const closed = t.beats.some((b) => b.state === 'closes')
    const opened = t.beats.some((b) => b.state === 'opens')
    const status: ThreadStatus = closed ? 'resolved' : opened ? 'open' : 'active'

    // Unique scene paths — a scene counts once even if it tags the thread twice.
    const paths = new Set(t.beats.map((b) => b.path))
    const words = [...paths].reduce((n, p) => n + (wordsByPath.get(p) ?? 0), 0)

    // First/last appearance in manuscript order (fall back to thread order).
    const byAppearance = [...t.beats].sort((a, b) => orderKey(a) - orderKey(b))
    const firstTitle = byAppearance[0]?.title ?? ''
    const lastTitle = byAppearance[byAppearance.length - 1]?.title ?? ''

    // Silence: scenes after the thread's last placed beat, unless it's resolved.
    let silent = 0
    if (!closed) {
      const placed = t.beats.filter((b) => b.manuscriptOrder != null)
      if (placed.length) {
        const last = Math.max(...placed.map((b) => b.manuscriptOrder as number))
        silent = ordered.filter((s) => s.order > last).length
      }
    }

    return {
      tag: t.tag,
      name: t.name,
      color: t.color,
      path: t.path,
      beats: t.beats.length,
      words,
      firstTitle,
      lastTitle,
      status,
      dangling: opened && !closed,
      silent
    }
  })
}
