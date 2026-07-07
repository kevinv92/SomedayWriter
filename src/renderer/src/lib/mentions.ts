import type { Entity } from '@shared/types'

/**
 * Renderer-side mention resolution (Phase 5, M8c) — the go-to-definition lookup.
 * Mirrors `referencesTo`'s matching rules in the main process (`story-index.ts`)
 * so the same surface forms that get *found* also *resolve*: whole-word matches
 * on an entity's canonical name or any alias, longest surface winning at a spot
 * ("Mara Venn" over "Mara"), covering both bare mentions and the braced
 * `@{surface}` insert form (the braces are non-word, so the boundaries still hold).
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The entity whose surface form sits under a cursor, or `null` if none does.
 * `lineText` is the full line; `column` is 1-based (as reported by the editor).
 */
export function entityAt(
  lineText: string,
  column: number,
  entities: Entity[]
): Entity | null {
  const cursor = column - 1 // 0-based offset into the line
  const surfaces: { text: string; entity: Entity }[] = []
  for (const entity of entities) {
    for (const surface of [entity.name, ...entity.aliases]) {
      if (surface) surfaces.push({ text: surface, entity })
    }
  }
  // Longest first so a multi-word name wins over a substring alias at the same spot.
  surfaces.sort((a, b) => b.text.length - a.text.length)
  for (const { text, entity } of surfaces) {
    const re = new RegExp(`(?<![\\w])${escapeRegExp(text)}(?![\\w])`, 'g')
    let m: RegExpExecArray | null
    while ((m = re.exec(lineText)) !== null) {
      // Inclusive of the trailing edge so a caret just after the word still resolves.
      if (cursor >= m.index && cursor <= m.index + text.length) return entity
    }
  }
  return null
}
