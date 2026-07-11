import type { AnalysisProvider, Completion, CompletionContext } from '../types'
import type { Entity } from '@shared/types'

/**
 * Completion provider for `@`-mentions of story entities (Phase 5 M8, made fully
 * type-generic in Phase 7 M17 — the former `CharacterProvider`). Its data comes
 * from `StoryIndex` (the project's profile files) via `setEntities`; it offers
 * each entity's canonical name + every alias, inserting the braced `@{surface}`
 * form (multi-word, stripped on export). Every entity type — character, location,
 * item, faction, lore, or an unknown one — completes through this one
 * path, with the type shown as the completion's category badge.
 */
export function createEntityProvider(): {
  provider: AnalysisProvider
  setEntities: (entities: Entity[]) => void
} {
  let entities: Entity[] = []
  const provider: AnalysisProvider = {
    id: 'entity',
    capabilities: ['completion'],
    complete(ctx: CompletionContext): Completion[] {
      // Only offer entities when the cursor sits in an `@`-mention token, so we
      // stand down inside frontmatter (M19) and anywhere else.
      if (!/@[\w]*$/.test(ctx.text.slice(0, ctx.offset))) return []
      return entities.flatMap((entity) =>
        [entity.name, ...entity.aliases].map((surface) => ({
          label: `@${surface}`,
          apply: `@{${surface}}`,
          // Canonical entry lists its aliases (so you can see what else it's known
          // as); an alias entry points back to the canonical name.
          detail:
            surface === entity.name
              ? entity.aliases.length
                ? `${entity.type} · aka ${entity.aliases.join(', ')}`
                : entity.type
              : `→ ${entity.name}`,
          type: entity.type
        }))
      )
    }
  }
  return { provider, setEntities: (next) => (entities = next) }
}
