import { describe, expect, it } from 'vitest'
import type { Entity } from '@shared/types'
import { entityAt, mentionRangeAt } from './mentions'

const ent = (name: string, aliases: string[] = []): Entity => ({
  id: name.toLowerCase(),
  type: 'character',
  name,
  aliases,
  path: `characters/${name}.md`
})

const entities = [
  ent('Irene Adler', ['Irene', 'the woman']),
  ent('Sherlock Holmes', ['Holmes'])
]

// "To @{Sherlock Holmes} she is @{Irene}."
//  012345678901234567890123456789012345678
const line = 'To @{Sherlock Holmes} she is @{Irene}.'

describe('entityAt (go-to-definition)', () => {
  it('resolves the mention under the cursor by canonical name', () => {
    // column is 1-based; put the cursor inside "@{Sherlock Holmes}"
    expect(entityAt(line, 8, entities)?.name).toBe('Sherlock Holmes')
  })

  it('resolves by alias', () => {
    expect(entityAt(line, 32, entities)?.name).toBe('Irene Adler')
  })

  it('returns null when the cursor is on plain prose', () => {
    expect(entityAt(line, 2, entities)).toBeNull() // on "To"
  })

  it('returns null for an unknown surface', () => {
    expect(entityAt('see @{Nobody} here', 8, entities)).toBeNull()
  })
})

describe('mentionRangeAt (the ⌘-hover underline)', () => {
  it('spans the whole @{…} token when it resolves', () => {
    const r = mentionRangeAt(line, 8, entities)
    expect(r).toEqual({ from: 3, to: 21 }) // "@{Sherlock Holmes}"
    expect(line.slice(r!.from, r!.to)).toBe('@{Sherlock Holmes}')
  })

  it('is null for an unresolved mention (no accidental links)', () => {
    expect(mentionRangeAt('see @{Nobody} here', 8, entities)).toBeNull()
  })
})
