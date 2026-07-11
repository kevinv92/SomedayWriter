import { describe, expect, it } from 'vitest'
import type { ManuscriptScene, Thread, ThreadBeat } from '@shared/types'
import { threadStats } from './thread-stats'

const beat = (path: string, order: number | null): ThreadBeat => ({
  path,
  title: path,
  manuscriptOrder: order,
  threadOrder: order,
  summary: null,
  intensity: null
})

const thread = (tag: string, beats: ThreadBeat[]): Thread => ({
  name: tag,
  tag,
  color: null,
  description: '',
  path: `threads/${tag}.md`,
  beats
})

const scene = (path: string, order: number, words: number): ManuscriptScene => ({
  path,
  order,
  title: path,
  words
})

describe('threadStats', () => {
  const scenes = [
    scene('s1', 1, 100),
    scene('s2', 2, 200),
    scene('s3', 3, 300),
    scene('s4', 4, 400),
    scene('s5', 5, 500)
  ]

  it('sums words across the thread scenes and counts beats', () => {
    const [stat] = threadStats([thread('case', [beat('s1', 1), beat('s3', 3)])], scenes)
    expect(stat.beats).toBe(2)
    expect(stat.words).toBe(400) // 100 + 300
    expect(stat.firstTitle).toBe('s1')
    expect(stat.lastTitle).toBe('s3')
  })

  it('counts scenes after the last placed beat as silence', () => {
    // last beat at order 2; scenes s3,s4,s5 come after → 3 silent
    const [stat] = threadStats([thread('case', [beat('s1', 1), beat('s2', 2)])], scenes)
    expect(stat.silent).toBe(3)
  })

  it('an unplaced thread has no silence and empty span', () => {
    const [stat] = threadStats([thread('case', [beat('x', null)])], scenes)
    expect(stat.silent).toBe(0)
    expect(stat.firstTitle).toBe('x')
  })

  it('counts a scene once even if a thread tags it twice', () => {
    const [stat] = threadStats([thread('case', [beat('s1', 1), beat('s1', 1)])], scenes)
    expect(stat.words).toBe(100)
  })
})
