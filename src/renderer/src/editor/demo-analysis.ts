import type { CompletionSource, Diagnostic } from './types'

/**
 * Phase 1 stand-ins that prove the seam end to end. These are deliberately
 * dumb — Phase 4 (AnalysisService) and Phase 5 (StoryIndex) replace them with
 * real, pluggable providers. They live outside the adapter: the "brain" is
 * separate from the editor.
 */

// Later derived from StoryIndex (canonical name + aliases from profile files);
// hard-coded here to mirror the sample-project fixture. Every surface form
// resolves to one character.
interface DemoCharacter {
  /** Canonical name (the entity). */
  name: string
  /** Full names, nicknames, epithets — all link back to `name`. */
  aliases: string[]
}

const CHARACTERS: DemoCharacter[] = [
  { name: 'Mara', aliases: ['Mara Venn', 'the courier'] },
  { name: 'Corvin', aliases: ['Captain Corvin', 'the captain'] }
]

/**
 * Offers the canonical name and every alias, each tagged with the character it
 * resolves to. Inserts the braced mention form `@{surface}` so multi-word names
 * ("the courier", "Captain Corvin") work; export strips the `@{…}` wrapper,
 * leaving the surface text. You filter by typing (`@the` → "the courier"),
 * the display shows `@surface`, and the inserted text is `@{surface}`.
 */
export const characterCompletionSource: CompletionSource = (_ctx) =>
  CHARACTERS.flatMap((character) =>
    [character.name, ...character.aliases].map((surface) => ({
      label: `@${surface}`,
      apply: `@{${surface}}`,
      detail: surface === character.name ? 'character' : `→ ${character.name}`,
      type: 'character'
    }))
  )

// Overused "crutch" words a writer might want flagged — demo diagnostics only.
const CRUTCH_WORDS = [
  'just',
  'very',
  'really',
  'quite',
  'always',
  'seemed',
  'almost',
  'quietly'
]

export function crutchWordDiagnostics(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  const re = new RegExp(`\\b(${CRUTCH_WORDS.join('|')})\\b`, 'gi')
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    diagnostics.push({
      from: match.index,
      to: match.index + match[0].length,
      severity: 'warning',
      message: `Crutch word: "${match[0]}" — consider cutting.`,
      source: 'demo:crutch'
    })
  }
  return diagnostics
}
