import { describe, expect, it } from 'vitest'
import type { Thread, ThreadBeat, ThreadState } from '../shared/types'
import { computeNeglected, parseThreadTags, type SceneGap } from './story-index'

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

const beat = (
  order: number | null,
  state: ThreadState,
  extra: Partial<ThreadBeat> = {}
): ThreadBeat => ({
  path: `s${order}.md`,
  title: `Scene ${order}`,
  manuscriptOrder: order,
  threadOrder: null,
  summary: null,
  intensity: null,
  state,
  ...extra
})

const thd = (tag: string, beats: ThreadBeat[]): Thread => ({
  name: tag,
  tag,
  color: null,
  description: '',
  path: null,
  beats
})

const scenes: SceneGap[] = [10, 20, 30, 40, 50, 60, 70].map((order) => ({
  order,
  words: 100
}))

describe('computeNeglected (pacing lint)', () => {
  it('flags a thread that went quiet without closing', () => {
    // last beat at order 20; scenes 30..70 (5) come after → neglected
    const out = computeNeglected(
      [thd('quiet', [beat(10, 'opens'), beat(20, 'touches')])],
      scenes
    )
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ tag: 'quiet', scenes: 5, words: 500, dangling: true })
  })

  it('never flags a thread that closes (resolved)', () => {
    expect(
      computeNeglected([thd('done', [beat(10, 'opens'), beat(20, 'closes')])], scenes)
    ).toEqual([])
  })

  it('does not flag a thread active near the end (gap below threshold)', () => {
    // last beat at 60; only scene 70 after → 1 < 3
    expect(computeNeglected([thd('active', [beat(60, 'touches')])], scenes)).toEqual([])
  })

  it('sorts most-neglected first and carries the "since" label', () => {
    const out = computeNeglected(
      [
        thd('a', [beat(40, 'touches', { summary: 'the plan' })]),
        thd('b', [beat(10, 'touches')])
      ],
      scenes
    )
    expect(out.map((n) => n.tag)).toEqual(['b', 'a']) // b (6 scenes) before a (3)
    expect(out.find((n) => n.tag === 'a')?.since).toBe('the plan')
  })

  it('respects a custom gap threshold', () => {
    const t = [thd('x', [beat(40, 'touches')])] // 3 scenes after
    expect(computeNeglected(t, scenes, 4)).toEqual([]) // 3 < 4
    expect(computeNeglected(t, scenes, 3)).toHaveLength(1)
  })
})
