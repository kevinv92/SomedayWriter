/**
 * Pure frontmatter-position analysis for intellisense (Phase 7, M19). Given the
 * document text and a cursor offset, decide whether the cursor sits inside the
 * leading `---` … `---` YAML block and, if so, whether it's completing a **key**
 * or a **value** (and which key's value). Editor-agnostic — it works on a string
 * + offset, so the completion provider and any future consumer share one notion
 * of "where am I in the frontmatter".
 */

export type FrontmatterContext =
  | { in: false }
  | { in: true; kind: 'key'; prefix: string }
  | { in: true; kind: 'value'; key: string; prefix: string }

type Line = { start: number; text: string }

/** Split text into lines carrying their start offsets; `\r` is trimmed so CRLF
 * docs behave like LF. */
function lines(text: string): Line[] {
  const out: Line[] = []
  let start = 0
  for (const raw of text.split('\n')) {
    out.push({ start, text: raw.replace(/\r$/, '') })
    start += raw.length + 1 // + the '\n'
  }
  return out
}

/** Index range [firstInterior, lastInterior] of the frontmatter body lines, or
 * null when the doc has no leading `---` fence. When the block is unterminated
 * (still being typed) the interior runs to the last line. `closeIndex` is the
 * closing fence's line index, or -1 when unterminated. */
function frontmatterBody(
  ls: Line[]
): { first: number; last: number; closeIndex: number } | null {
  if (ls.length === 0 || ls[0].text.trim() !== '---') return null
  for (let i = 1; i < ls.length; i++) {
    if (ls[i].text.trim() === '---') return { first: 1, last: i - 1, closeIndex: i }
  }
  return { first: 1, last: ls.length - 1, closeIndex: -1 }
}

/** The `type:` value declared in the frontmatter, or null. Used to pick which
 * type's fields to offer. */
export function declaredType(text: string): string | null {
  const ls = lines(text)
  const body = frontmatterBody(ls)
  if (!body) return null
  for (let i = body.first; i <= body.last; i++) {
    const m = ls[i].text.match(/^type:\s*(.+?)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '') || null
  }
  return null
}

/** Keys already present in the frontmatter (top-level `key:` lines), so the
 * completer can avoid offering duplicates. */
export function frontmatterKeys(text: string): string[] {
  const ls = lines(text)
  const body = frontmatterBody(ls)
  if (!body) return []
  const keys: string[] = []
  for (let i = body.first; i <= body.last; i++) {
    const m = ls[i].text.match(/^([A-Za-z0-9_-]+):/)
    if (m) keys.push(m[1])
  }
  return keys
}

/** The last token being typed in an inline value (`aliases: [a, b|`) or a plain
 * value (`type: cha|`): text after the last `[` or `,`, leading space trimmed. */
function inlineValuePrefix(afterColon: string): string {
  const tail = afterColon.split(/[[,]/).pop() ?? afterColon
  return tail.replace(/^\s+/, '')
}

/**
 * Classify the cursor within the frontmatter. Returns `{ in: false }` when the
 * cursor is outside the block or on a fence line; otherwise a key- or
 * value-completion context with the token prefix already typed.
 */
export function frontmatterContextAt(text: string, offset: number): FrontmatterContext {
  const ls = lines(text)
  const body = frontmatterBody(ls)
  if (!body) return { in: false }

  // Which line is the cursor on?
  let idx = ls.length - 1
  for (let i = 0; i < ls.length; i++) {
    const end = ls[i].start + ls[i].text.length
    if (offset <= end) {
      idx = i
      break
    }
  }
  // Fence lines and anything outside the body don't complete.
  if (idx < body.first || idx > body.last) return { in: false }
  if (idx === body.closeIndex) return { in: false }

  const line = ls[idx].text
  const before = text.slice(ls[idx].start, offset)

  // Block sequence item (`  - value`): the value of the nearest owning key above.
  const seq = before.match(/^(\s*)-\s+(.*)$/)
  if (seq) {
    const indent = seq[1].length
    for (let i = idx - 1; i >= body.first; i--) {
      const owner = ls[i].text.match(/^(\s*)([A-Za-z0-9_-]+):\s*$/)
      if (owner && owner[1].length < indent) {
        return { in: true, kind: 'value', key: owner[2], prefix: seq[2].trim() }
      }
    }
    return { in: true, kind: 'value', key: '', prefix: seq[2].trim() }
  }

  const colon = line.indexOf(':')
  const col = before.length
  if (colon === -1 || col <= colon) {
    // Before the colon (or no colon yet) → completing a key.
    return { in: true, kind: 'key', prefix: before.replace(/^\s+/, '') }
  }
  // After the colon → completing that key's value.
  return {
    in: true,
    kind: 'value',
    key: line.slice(0, colon).trim(),
    prefix: inlineValuePrefix(before.slice(colon + 1))
  }
}
