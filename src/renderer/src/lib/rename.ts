import { parse } from 'yaml'

/** An entity file's identity surfaces, from its frontmatter. */
export type EntityHead = { name: string; aliases: string[] }

/** Parse an entity file's frontmatter head (name + aliases) from buffer text. */
export function parseEntityHead(text: string): EntityHead | null {
  const m = text.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return null
  try {
    const data = (parse(m[1]) ?? {}) as Record<string, unknown>
    const name = typeof data.name === 'string' ? data.name.trim() : ''
    const aliases = Array.isArray(data.aliases)
      ? data.aliases
          .filter((x): x is string => typeof x === 'string')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    return { name, aliases }
  } catch {
    return null
  }
}

/**
 * Position-based rename detection between a baseline head and the current one: a
 * surface (name or alias) whose value changed in place — the old value is gone
 * and the new value is fresh — is a rename. Returns the first such pair, or null.
 * (Additions and pure removals aren't renames; removals surface in Health.)
 */
export function detectRename(
  base: EntityHead,
  cur: EntityHead
): { from: string; to: string } | null {
  const b = [base.name, ...base.aliases]
  const c = [cur.name, ...cur.aliases]
  const n = Math.min(b.length, c.length)
  for (let i = 0; i < n; i++) {
    if (b[i] && c[i] && b[i] !== c[i] && !c.includes(b[i]) && !b.includes(c[i])) {
      return { from: b[i], to: c[i] }
    }
  }
  return null
}
