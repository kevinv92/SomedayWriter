import type { AnalysisProvider, Completion, CompletionContext } from '../types'
import type { Entity } from '@shared/types'

/**
 * Completion provider for `@`-mentions of story entities — the real
 * `CharacterProvider` (Phase 5, M8), replacing the Phase-4 hardcoded demo. Its
 * data comes from `StoryIndex` (the project's profile files) via `setEntities`;
 * it offers each entity's canonical name + every alias, inserting the braced
 * `@{surface}` form (multi-word, stripped on export). Type-generic — a location
 * or item profile completes the same way (Phase 7).
 */
export function createCharacterProvider(): {
  provider: AnalysisProvider
  setEntities: (entities: Entity[]) => void
} {
  let entities: Entity[] = []
  const provider: AnalysisProvider = {
    id: 'character',
    capabilities: ['completion'],
    complete(_ctx: CompletionContext): Completion[] {
      return entities.flatMap((entity) =>
        [entity.name, ...entity.aliases].map((surface) => ({
          label: `@${surface}`,
          apply: `@{${surface}}`,
          detail: surface === entity.name ? entity.type : `→ ${entity.name}`,
          type: entity.type
        }))
      )
    }
  }
  return { provider, setEntities: (next) => (entities = next) }
}
