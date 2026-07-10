import { describe, expect, it } from 'vitest'
import { parseThreadTags } from './story-index'

describe('parseThreadTags (Threads v2 beat fields)', () => {
  it('parses the bare-id form with sane defaults', () => {
    expect(parseThreadTags(['the-case', ' the-woman '])).toEqual([
      { tag: 'the-case', order: null, summary: null, intensity: null, state: 'touches' },
      { tag: 'the-woman', order: null, summary: null, intensity: null, state: 'touches' }
    ])
  })

  it('reads pos / summary / intensity / state off the object form', () => {
    const [beat] = parseThreadTags([
      {
        name: 'the-case',
        pos: 3,
        summary: 'Holmes is hired',
        intensity: 'setup',
        state: 'opens'
      }
    ])
    expect(beat).toEqual({
      tag: 'the-case',
      order: 3,
      summary: 'Holmes is hired',
      intensity: 'setup',
      state: 'opens'
    })
  })

  it('uses pos (not the old order key) for the per-thread position', () => {
    // `order` is the manuscript key — it must NOT set the per-thread position now
    expect(parseThreadTags([{ name: 'x', order: 5 }])[0].order).toBeNull()
    expect(parseThreadTags([{ name: 'x', pos: 5 }])[0].order).toBe(5)
  })

  it('drops unknown enum values and defaults state to touches', () => {
    const [beat] = parseThreadTags([{ name: 'x', intensity: 'nonsense', state: 'bogus' }])
    expect(beat.intensity).toBeNull()
    expect(beat.state).toBe('touches')
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
