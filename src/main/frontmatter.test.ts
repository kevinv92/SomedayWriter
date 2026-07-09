import { describe, expect, it } from 'vitest'
import {
  deriveTitle,
  parseFrontmatter,
  parseFrontmatterDetailed,
  readOrder,
  writeOrder
} from './frontmatter'

describe('parseFrontmatter', () => {
  it('parses fields and returns the body', () => {
    const { data, body } = parseFrontmatter(
      '---\ntype: character\nname: Holmes\n---\nBody.'
    )
    expect(data.type).toBe('character')
    expect(data.name).toBe('Holmes')
    expect(body).toBe('Body.')
  })

  it('returns empty data and the whole text when there is no block', () => {
    const { data, body } = parseFrontmatter('No frontmatter here.')
    expect(data).toEqual({})
    expect(body).toBe('No frontmatter here.')
  })

  it('swallows malformed YAML but reports a warning', () => {
    const { data, warnings } = parseFrontmatterDetailed('---\n: : bad\n\t- x\n---\nB')
    expect(data).toEqual({})
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('deriveTitle', () => {
  it('prefers frontmatter title', () => {
    expect(deriveTitle('---\ntitle: The Woman\n---\n# Heading\nx', 'a/01-woman.md')).toBe(
      'The Woman'
    )
  })

  it('falls back to the first heading', () => {
    expect(deriveTitle('# A Scandal\n\nprose', 'a/scene.md')).toBe('A Scandal')
  })

  it('falls back to a prettified filename', () => {
    expect(deriveTitle('just prose', 'a/b/01-the-empty-nest.md')).toBe('the-empty-nest')
  })
})

describe('readOrder / writeOrder', () => {
  it('reads a numeric order from frontmatter', () => {
    expect(readOrder('---\norder: 30\ntype: scene\n---\nx')).toBe(30)
    expect(readOrder('no frontmatter')).toBeNull()
    expect(readOrder('---\ntype: scene\n---\nx')).toBeNull()
  })

  it('replaces an existing order line, changing nothing else', () => {
    const out = writeOrder('---\ntitle: X\norder: 5\n---\nBody', 20)
    expect(readOrder(out)).toBe(20)
    expect(out).toContain('title: X')
    expect(out).toContain('Body')
    expect(out).not.toContain('order: 5')
  })

  it('inserts order into a block that lacks it', () => {
    const out = writeOrder('---\ntitle: X\n---\nBody', 7)
    expect(readOrder(out)).toBe(7)
    expect(out).toContain('title: X')
  })

  it('creates a frontmatter block when the file has none', () => {
    const out = writeOrder('Body only', 3)
    expect(readOrder(out)).toBe(3)
    expect(out).toContain('Body only')
  })
})
