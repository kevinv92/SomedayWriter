import type { Entity } from '@shared/types'

/**
 * Renderer-side mention resolution (Phase 5, M8c) — the go-to-definition lookup.
 * Mentions are **explicit** `@{surface}` references (a surface being an entity's
 * canonical name or any alias); plain prose text is never auto-linked, so there
 * are no false positives and a rename is an exact find-replace. Mirrors
 * `referencesTo`'s matching in the main process (`story-index.ts`).
 */

const MENTION_RE = /@\{([^}]*)\}/g

/** The entity whose `@{surface}` mention sits under the cursor, or null. */
export function entityAt(
  lineText: string,
  column: number,
  entities: Entity[]
): Entity | null {
  const range = mentionUnder(lineText, column)
  if (!range) return null
  return (
    entities.find((e) => e.name === range.surface || e.aliases.includes(range.surface)) ??
    null
  )
}

/** The 0-based char range of the `@{…}` mention under the cursor (for the
 * ⌘/Ctrl-hover "clickable" underline), if its surface resolves to an entity. */
export function mentionRangeAt(
  lineText: string,
  column: number,
  entities: Entity[]
): { from: number; to: number } | null {
  const range = mentionUnder(lineText, column)
  if (!range) return null
  const ok = entities.some(
    (e) => e.name === range.surface || e.aliases.includes(range.surface)
  )
  return ok ? { from: range.from, to: range.to } : null
}

/** The `@{…}` token spanning the 1-based `column`, with its inner surface. */
function mentionUnder(
  lineText: string,
  column: number
): { surface: string; from: number; to: number } | null {
  const cursor = column - 1
  MENTION_RE.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = MENTION_RE.exec(lineText)) !== null) {
    const from = m.index
    const to = m.index + m[0].length
    if (cursor >= from && cursor <= to) {
      return { surface: m[1].trim(), from, to }
    }
  }
  return null
}
