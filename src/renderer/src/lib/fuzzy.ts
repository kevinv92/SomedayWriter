/**
 * Tiny subsequence fuzzy matcher for Quick Open / the command palette. Returns a
 * score (higher = better) or null when `query` isn't a subsequence of `text`.
 * No dependency — a small scorer with bonuses for consecutive and word-boundary
 * matches, and a mild preference for shorter targets.
 */
export function fuzzyScore(query: string, text: string): number | null {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let last = -2
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] !== q[qi]) continue
    score += last === ti - 1 ? 3 : 1 // consecutive run bonus
    if (ti === 0 || /[\s\-_/.]/.test(t[ti - 1])) score += 2 // word-start bonus
    last = ti
    qi++
  }
  return qi === q.length ? score - text.length * 0.01 : null
}
