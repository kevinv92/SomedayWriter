import { describe, expect, it } from 'vitest'
import { findMatches, replaceAll } from './search'

const text = 'The cat sat.\nThe CAT ran.\nA dog.'

describe('findMatches', () => {
  it('reports 1-based line/column with the line as preview', () => {
    const m = findMatches(text, 'cat')
    // case-insensitive by default → both "cat" and "CAT"
    expect(m).toHaveLength(2)
    expect(m[0]).toEqual({ line: 1, column: 5, preview: 'The cat sat.' })
    expect(m[1]).toEqual({ line: 2, column: 5, preview: 'The CAT ran.' })
  })

  it('honours caseSensitive', () => {
    expect(findMatches(text, 'cat', { caseSensitive: true })).toHaveLength(1)
  })

  it('finds every occurrence on a line', () => {
    expect(findMatches('aaa', 'a')).toHaveLength(3)
  })

  it('returns nothing for an empty query', () => {
    expect(findMatches(text, '')).toEqual([])
  })
})

describe('replaceAll', () => {
  it('replaces case-insensitively and counts', () => {
    const r = replaceAll(text, 'the', 'A')
    expect(r.count).toBe(2)
    expect(r.text).toBe('A cat sat.\nA CAT ran.\nA dog.')
  })

  it('replaces only exact case when caseSensitive', () => {
    const r = replaceAll(text, 'CAT', 'dog', { caseSensitive: true })
    expect(r.count).toBe(1)
    expect(r.text).toContain('The dog ran.')
    expect(r.text).toContain('The cat sat.')
  })

  it('is a no-op for an empty query', () => {
    expect(replaceAll(text, '', 'x')).toEqual({ text, count: 0 })
  })
})
