import type { Thread } from '@shared/types'

/** A branch or merge inferred from per-beat `state` (Threads v2, #5). */
export type ThreadLink = {
  kind: 'branch' | 'merge'
  /** Scene (path) where the split/join happens. */
  scene: string
  /** Tag of the thread that opens here. */
  opener: string
  /** Branch: the thread(s) it splits off from. Merge: the thread(s) that end
   *  here and flow into `opener`. */
  others: string[]
}

/**
 * Infer branch/merge topology from beats' `state`, with no explicit edges. At a
 * scene where a thread **opens**:
 *   - if other threads **close** there → a **merge** (the closers flow into it);
 *   - else if other threads merely **continue** (touch) → a **branch** off them.
 * A thread that just `closes` (no opener in the same scene) is an ending, not a
 * link.
 */
export function inferThreadLinks(threads: Thread[]): ThreadLink[] {
  // scene path → the threads with a beat there, each with its state
  const byScene = new Map<string, { tag: string; state: string }[]>()
  for (const t of threads) {
    for (const b of t.beats) {
      const arr = byScene.get(b.path)
      if (arr) arr.push({ tag: t.tag, state: b.state })
      else byScene.set(b.path, [{ tag: t.tag, state: b.state }])
    }
  }

  const links: ThreadLink[] = []
  for (const [scene, entries] of byScene) {
    const openers = entries.filter((e) => e.state === 'opens').map((e) => e.tag)
    if (!openers.length) continue
    const closers = entries.filter((e) => e.state === 'closes').map((e) => e.tag)
    const continuers = entries.filter((e) => e.state === 'touches').map((e) => e.tag)
    for (const opener of openers) {
      if (closers.length) links.push({ kind: 'merge', scene, opener, others: closers })
      else if (continuers.length)
        links.push({ kind: 'branch', scene, opener, others: continuers })
    }
  }
  return links
}
