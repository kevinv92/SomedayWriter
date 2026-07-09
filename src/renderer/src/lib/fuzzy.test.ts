import { describe, expect, it } from 'vitest'
import { fuzzyScore } from './fuzzy'

describe('fuzzyScore (Quick Open / command palette)', () => {
  it('matches a subsequence and rejects a non-subsequence', () => {
    expect(fuzzyScore('brl', 'briony-lodge.md')).not.toBeNull()
    expect(fuzzyScore('xyz', 'briony-lodge.md')).toBeNull()
  })

  it('is case-insensitive', () => {
    expect(fuzzyScore('HOL', 'holmes.md')).not.toBeNull()
  })

  it('an empty query matches everything (score 0)', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })

  it('scores a consecutive/prefix match above a scattered one', () => {
    const consecutive = fuzzyScore('holm', 'holmes.md')!
    const scattered = fuzzyScore('hoes', 'holmes.md')!
    expect(consecutive).toBeGreaterThan(scattered)
  })

  it('rewards a word-boundary (prefix) match over the same run mid-word', () => {
    // both match "br" consecutively; only the first sits at a word start
    const atStart = fuzzyScore('br', 'briony')!
    const midWord = fuzzyScore('br', 'abrase')!
    expect(atStart).toBeGreaterThan(midWord)
  })

  it('matches by folder path, not just name (Quick Open searches the rel path)', () => {
    expect(fuzzyScore('act2', 'manuscript/act-2/scene.md')).not.toBeNull()
  })

  it('mildly prefers shorter targets on an equal match', () => {
    expect(fuzzyScore('ab', 'ab')!).toBeGreaterThan(fuzzyScore('ab', 'ab-longer-name')!)
  })
})
