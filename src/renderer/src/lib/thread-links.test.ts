import { describe, expect, it } from 'vitest'
import type { Thread, ThreadBeat, ThreadState } from '@shared/types'
import { inferThreadLinks } from './thread-links'

const beat = (path: string, state: ThreadState): ThreadBeat => ({
  path,
  title: path,
  manuscriptOrder: null,
  threadOrder: null,
  summary: null,
  intensity: null,
  state
})

const thread = (tag: string, beats: [string, ThreadState][]): Thread => ({
  name: tag,
  tag,
  color: null,
  description: '',
  path: null,
  beats: beats.map(([p, s]) => beat(p, s))
})

describe('inferThreadLinks', () => {
  it('branches: an opener where another thread continues', () => {
    // the-disguise opens at s3, where the-case is touching
    const threads = [
      thread('the-case', [
        ['s2', 'touches'],
        ['s3', 'touches']
      ]),
      thread('the-disguise', [['s3', 'opens']])
    ]
    expect(inferThreadLinks(threads)).toEqual([
      { kind: 'branch', scene: 's3', opener: 'the-disguise', others: ['the-case'] }
    ])
  })

  it('merges: an opener where other threads close', () => {
    // the-outwitting opens at s7, where the-woman and the-case both close
    const threads = [
      thread('the-woman', [
        ['s1', 'opens'],
        ['s7', 'closes']
      ]),
      thread('the-case', [
        ['s2', 'opens'],
        ['s7', 'closes']
      ]),
      thread('the-outwitting', [['s7', 'opens']])
    ]
    const links = inferThreadLinks(threads)
    expect(links).toContainEqual({
      kind: 'merge',
      scene: 's7',
      opener: 'the-outwitting',
      others: ['the-woman', 'the-case']
    })
    // the s1 opener has nobody else present → no link
    expect(links.filter((l) => l.scene === 's1')).toEqual([])
  })

  it('a lone close is an ending, not a link', () => {
    const threads = [
      thread('a', [
        ['s1', 'opens'],
        ['s2', 'closes']
      ])
    ]
    expect(inferThreadLinks(threads)).toEqual([])
  })

  it('prefers merge over branch when both closers and continuers are present', () => {
    const threads = [
      thread('cont', [['s1', 'touches']]),
      thread('closing', [['s1', 'closes']]),
      thread('opener', [['s1', 'opens']])
    ]
    expect(inferThreadLinks(threads)).toEqual([
      { kind: 'merge', scene: 's1', opener: 'opener', others: ['closing'] }
    ])
  })
})
