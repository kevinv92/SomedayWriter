import { describe, expect, it } from 'vitest'
import { frontmatterContextAt } from './frontmatter-context'

/** Classify at the `|` marker (stripped before analysis). */
const at = (withCursor: string) => {
  const offset = withCursor.indexOf('|')
  return frontmatterContextAt(withCursor.replace('|', ''), offset)
}

const fm = (body: string) => `---\n${body}\n---\n\n# Scene\n`

describe('frontmatterContextAt — threads: beat objects', () => {
  it('completes an inner value enum (intensity)', () => {
    const ctx = at(fm('threads:\n  - { name: the-case, intensity: cli|'))
    expect(ctx).toEqual({ in: true, kind: 'value', key: 'intensity', prefix: 'cli' })
  })

  it('completes name: with the typed thread prefix', () => {
    const ctx = at(fm('threads:\n  - { name: the-|'))
    expect(ctx).toEqual({ in: true, kind: 'value', key: 'name', prefix: 'the-' })
  })

  it('offers an inner key, dropping the ones already present', () => {
    const ctx = at(fm('threads:\n  - { name: the-case, int|'))
    expect(ctx).toEqual({
      in: true,
      kind: 'threadKey',
      prefix: 'int',
      present: ['name']
    })
  })

  it('offers inner keys in an empty beat object', () => {
    const ctx = at(fm('threads:\n  - {|'))
    expect(ctx).toEqual({ in: true, kind: 'threadKey', prefix: '', present: [] })
  })

  it('a flow object NOT under threads is not a beat object', () => {
    // owner is `meta`, so it falls through to generic sequence handling.
    const ctx = at(fm('meta:\n  - { name: x|'))
    expect(ctx.in).toBe(true)
    if (ctx.in) expect(ctx.kind).not.toBe('threadKey')
  })

  it('still classifies a bare threads id as a plain value', () => {
    const ctx = at(fm('threads:\n  - the-ca|'))
    expect(ctx).toEqual({ in: true, kind: 'value', key: 'threads', prefix: 'the-ca' })
  })
})
