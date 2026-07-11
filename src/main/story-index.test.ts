import { describe, expect, it } from 'vitest'
import { parseThreadTags, threadsWarnings } from './story-index'

describe('parseThreadTags (Threads v2 beat fields)', () => {
  it('parses the bare-id form with sane defaults', () => {
    expect(parseThreadTags(['the-case', ' the-woman '])).toEqual([
      { tag: 'the-case', order: null, summary: null, intensity: null },
      { tag: 'the-woman', order: null, summary: null, intensity: null }
    ])
  })

  it('reads pos / summary / intensity off the object form', () => {
    const [beat] = parseThreadTags([
      {
        name: 'the-case',
        pos: 3,
        summary: 'Holmes is hired',
        intensity: 'setup'
      }
    ])
    expect(beat).toEqual({
      tag: 'the-case',
      order: 3,
      summary: 'Holmes is hired',
      intensity: 'setup'
    })
  })

  it('uses pos (not the old order key) for the per-thread position', () => {
    // `order` is the manuscript key — it must NOT set the per-thread position now
    expect(parseThreadTags([{ name: 'x', order: 5 }])[0].order).toBeNull()
    expect(parseThreadTags([{ name: 'x', pos: 5 }])[0].order).toBe(5)
  })

  it('drops unknown enum values', () => {
    const [beat] = parseThreadTags([{ name: 'x', intensity: 'nonsense' }])
    expect(beat.intensity).toBeNull()
  })

  it('trims summary and treats blank as absent', () => {
    expect(parseThreadTags([{ name: 'x', summary: '  hi  ' }])[0].summary).toBe('hi')
    expect(parseThreadTags([{ name: 'x', summary: '   ' }])[0].summary).toBeNull()
  })

  it('ignores malformed entries and non-arrays', () => {
    expect(parseThreadTags('nope')).toEqual([])
    expect(parseThreadTags([{ pos: 1 }, '', 42, null])).toEqual([])
  })
})

describe('threadsWarnings (Threads v2 object form)', () => {
  it('accepts bare-id strings', () => {
    expect(threadsWarnings({ threads: ['the-case', 'the-woman'] })).toEqual([])
  })

  it('accepts beat objects with a name (no false "non-text" warning)', () => {
    expect(
      threadsWarnings({
        threads: [
          { name: 'the-case', pos: 3, intensity: 'rise' },
          'the-woman',
          { name: 'the-disguise', intensity: 'setup' }
        ]
      })
    ).toEqual([])
  })

  it('flags an object with no name', () => {
    expect(threadsWarnings({ threads: [{ pos: 1 }] })).toHaveLength(1)
  })

  it('flags a non-string, non-object entry', () => {
    expect(threadsWarnings({ threads: [42] })).toHaveLength(1)
  })

  it('flags a non-list threads value', () => {
    expect(threadsWarnings({ threads: 'the-case' })).toHaveLength(1)
  })

  it('is silent when threads is absent', () => {
    expect(threadsWarnings({})).toEqual([])
  })
})
