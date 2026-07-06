/**
 * Minimal, format-preserving frontmatter editing for the one field M6 needs:
 * the manuscript `order`. Deliberately NOT a general YAML parser — it reads and
 * rewrites only the `order:` line inside a leading `---` block, leaving every
 * other line (title, threads, body) byte-for-byte intact. A full YAML parser
 * arrives with Phase 5 when threads/aliases need structured parsing (see
 * SPEC → Deferred: config format / Story model). Line endings assumed LF.
 */

const DELIM = '---'
const ORDER_RE = /^order:\s*(-?\d+(?:\.\d+)?)\s*$/

type Frontmatter = { lines: string[]; open: number; close: number }

/** Locate a leading `---` … `---` block, or null if the text has none. */
function locate(text: string): Frontmatter | null {
  const lines = text.split('\n')
  if (lines[0]?.trim() !== DELIM) return null
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === DELIM) return { lines, open: 0, close: i }
  }
  return null
}

/** The manuscript `order` declared in the file's frontmatter, or null. */
export function readOrder(text: string): number | null {
  const fm = locate(text)
  if (!fm) return null
  for (let i = fm.open + 1; i < fm.close; i++) {
    const match = ORDER_RE.exec(fm.lines[i])
    if (match) return Number(match[1])
  }
  return null
}

/** Return `text` with `order` set to `value` — replacing the existing `order:`
 * line, inserting one into an existing frontmatter block, or creating a block
 * if the file has none. Nothing else in the file changes. */
export function writeOrder(text: string, value: number): string {
  const line = `order: ${value}`
  const fm = locate(text)
  if (!fm) return `${DELIM}\n${line}\n${DELIM}\n\n${text}`

  const { lines, open, close } = fm
  for (let i = open + 1; i < close; i++) {
    if (ORDER_RE.test(lines[i]) || /^order:/.test(lines[i])) {
      lines[i] = line
      return lines.join('\n')
    }
  }
  lines.splice(open + 1, 0, line)
  return lines.join('\n')
}
