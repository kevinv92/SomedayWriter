import type { SearchMatch, SearchOptions } from '../shared/types'

/**
 * Plain-substring search/replace over file text (M5, project-wide). Not regex —
 * that's a later refinement; the in-document find (`Cmd/Ctrl+F`) already offers
 * regex via CodeMirror. Pure functions so they're testable without fs.
 */

/** All matches of `query` in `text`, as 1-based line/column with the containing
 * line as preview. */
export function findMatches(
  text: string,
  query: string,
  opts: SearchOptions = {}
): SearchMatch[] {
  if (!query) return []
  const matches: SearchMatch[] = []
  const lines = text.split('\n')
  const needle = opts.caseSensitive ? query : query.toLowerCase()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const hay = opts.caseSensitive ? line : line.toLowerCase()
    let from = 0
    for (;;) {
      const idx = hay.indexOf(needle, from)
      if (idx === -1) break
      matches.push({ line: i + 1, column: idx + 1, preview: line })
      from = idx + needle.length
    }
  }
  return matches
}

/** Replace every occurrence of `query` with `replacement`; returns the new text
 * and the replacement count. */
export function replaceAll(
  text: string,
  query: string,
  replacement: string,
  opts: SearchOptions = {}
): { text: string; count: number } {
  if (!query) return { text, count: 0 }
  if (opts.caseSensitive) {
    const parts = text.split(query)
    return { text: parts.join(replacement), count: parts.length - 1 }
  }
  const lower = text.toLowerCase()
  const needle = query.toLowerCase()
  let out = ''
  let from = 0
  let count = 0
  for (;;) {
    const idx = lower.indexOf(needle, from)
    if (idx === -1) {
      out += text.slice(from)
      break
    }
    out += text.slice(from, idx) + replacement
    from = idx + needle.length
    count++
  }
  return { text: out, count }
}
