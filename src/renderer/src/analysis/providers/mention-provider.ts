import type { AnalysisProvider, Completion, CompletionContext } from '../types'

/**
 * Completion provider for `@`-mentions of characters. Demo data (Phase 1),
 * mirroring the sample-project fixture — Phase 5 replaces this with a
 * StoryIndex-backed CharacterProvider (canonical name + aliases from profile
 * files). The facade wiring stays identical; only the data source changes.
 */

interface DemoCharacter {
  name: string
  aliases: string[]
}

const CHARACTERS: DemoCharacter[] = [
  { name: 'Mara', aliases: ['Mara Venn', 'the courier'] },
  { name: 'Corvin', aliases: ['Captain Corvin', 'the captain'] }
]

// Offers the canonical name + every alias, each tagged with the character it
// resolves to. Inserts the braced form `@{surface}` so multi-word names work;
// export strips the wrapper, leaving the surface text.
function characterCompletions(_ctx: CompletionContext): Completion[] {
  return CHARACTERS.flatMap((character) =>
    [character.name, ...character.aliases].map((surface) => ({
      label: `@${surface}`,
      apply: `@{${surface}}`,
      detail: surface === character.name ? 'character' : `→ ${character.name}`,
      type: 'character'
    }))
  )
}

export function createMentionProvider(): AnalysisProvider {
  return {
    id: 'mention',
    capabilities: ['completion'],
    complete: characterCompletions
  }
}
