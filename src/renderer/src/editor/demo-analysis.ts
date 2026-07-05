import type { CompletionSource, Diagnostic } from './types'

/**
 * Phase 1 stand-ins that prove the seam end to end. These are deliberately
 * dumb — Phase 4 (AnalysisService) and Phase 5 (StoryIndex) replace them with
 * real, pluggable providers. They live outside the adapter: the "brain" is
 * separate from the editor.
 */

// Later derived from StoryIndex; hard-coded here.
const CHARACTERS = ['Mara', 'Corvin']

export const characterCompletionSource: CompletionSource = (_ctx) =>
  CHARACTERS.map((name) => ({
    label: `@${name}`,
    apply: `@${name}`,
    detail: 'character',
    type: 'character'
  }))

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
