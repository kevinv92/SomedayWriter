/**
 * Minimal, format-preserving frontmatter editing for the one field M6 needs:
 * the manuscript `order`. Deliberately NOT a general YAML parser — it reads and
 * rewrites only the `order:` line inside a leading `---` block, leaving every
 * other line (title, threads, body) byte-for-byte intact. A full YAML parser
 * arrives with Phase 5 when threads/aliases need structured parsing (see
 * SPEC → Deferred: config format / Story model). Line endings assumed LF.
 */

import { parse as parseYaml } from 'yaml'

const DELIM = '---'
const ORDER_RE = /^order:\s*(-?\d+(?:\.\d+)?)\s*$/
const FM_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

/**
 * Parse the leading `---` frontmatter block into structured data (real YAML) +
 * the remaining body. Malformed YAML yields empty data rather than throwing (the
 * inspector surfaces the problem). Unlike `readOrder`/`writeOrder` (which touch a
 * single line non-destructively), this reads the whole block for the StoryIndex.
 */
export function parseFrontmatter(text: string): {
  data: Record<string, unknown>
  body: string
} {
  const match = FM_BLOCK.exec(text)
  if (!match) return { data: {}, body: text }
  let data: Record<string, unknown> = {}
  try {
    const parsed: unknown = parseYaml(match[1])
    if (parsed && typeof parsed === 'object') data = parsed as Record<string, unknown>
  } catch {
    // malformed frontmatter — treat as no data
  }
  return { data, body: text.slice(match[0].length) }
}

function firstHeading(body: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(body)
  return match ? match[1].trim() : null
}

function prettifyFilename(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? path
  return base.replace(/\.md$/i, '').replace(/^\d+[-_\s]*/, '')
}

/** A file's display title: `frontmatter.title` → first `#` heading → filename
 * (SPEC → File titles). */
export function deriveTitle(text: string, path: string): string {
  const { data, body } = parseFrontmatter(text)
  if (typeof data.title === 'string' && data.title.trim()) return data.title.trim()
  return firstHeading(body) ?? prettifyFilename(path)
}

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
