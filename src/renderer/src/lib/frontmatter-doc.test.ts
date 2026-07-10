import { describe, expect, it } from 'vitest'
import {
  addFrontmatter,
  frontmatterData,
  parseFrontmatterDoc,
  setField,
  writeFrontmatterDoc
} from './frontmatter-doc'

const sample = `---
# a note to self
order: 30
type: scene
mood: tense
threads:
  - { name: the-case, intensity: rise }
---

# Briony Lodge

Body text here.
`

describe('frontmatter-doc — round-trip fidelity', () => {
  it('parses the block and reads its data', () => {
    const { doc, hasBlock } = parseFrontmatterDoc(sample)
    expect(hasBlock).toBe(true)
    const data = frontmatterData(doc)
    expect(data.order).toBe(30)
    expect(data.type).toBe('scene')
    expect(data.mood).toBe('tense')
    expect(data.threads).toEqual([{ name: 'the-case', intensity: 'rise' }])
  })

  it('editing one field keeps comments, order, and unknown keys', () => {
    const { doc } = parseFrontmatterDoc(sample)
    setField(doc, 'order', 40)
    const out = writeFrontmatterDoc(sample, doc)
    expect(out).toContain('# a note to self') // comment preserved
    expect(out).toContain('mood: tense') // unknown key preserved
    expect(out).toContain('order: 40') // edited
    expect(out).not.toContain('order: 30')
    // key order preserved: order still before type
    expect(out.indexOf('order:')).toBeLessThan(out.indexOf('type:'))
  })

  it('leaves the body byte-for-byte unchanged', () => {
    const { doc } = parseFrontmatterDoc(sample)
    setField(doc, 'order', 40)
    const out = writeFrontmatterDoc(sample, doc)
    expect(out.endsWith('\n# Briony Lodge\n\nBody text here.\n')).toBe(true)
  })

  it('a no-op edit is a faithful re-emit (comments + threads intact)', () => {
    const { doc } = parseFrontmatterDoc(sample)
    const out = writeFrontmatterDoc(sample, doc)
    expect(out).toContain('# a note to self')
    expect(out).toContain('name: the-case')
    expect(out).toContain('# Briony Lodge')
  })

  it('adds a new field without disturbing the rest', () => {
    const { doc } = parseFrontmatterDoc(sample)
    setField(doc, 'when', 5)
    const out = writeFrontmatterDoc(sample, doc)
    expect(out).toContain('when: 5')
    expect(out).toContain('mood: tense')
  })

  it('setField(undefined) removes the key', () => {
    const { doc } = parseFrontmatterDoc(sample)
    setField(doc, 'mood', undefined)
    const out = writeFrontmatterDoc(sample, doc)
    expect(out).not.toContain('mood:')
    expect(out).toContain('type: scene')
  })
})

describe('frontmatter-doc — no block yet', () => {
  const noBlock = `# Just a title\n\nSome prose.\n`

  it('reports no block and gives an empty map', () => {
    const { hasBlock, doc } = parseFrontmatterDoc(noBlock)
    expect(hasBlock).toBe(false)
    expect(frontmatterData(doc)).toEqual({})
  })

  it('addFrontmatter seeds clean empty fields and keeps the body', () => {
    const out = addFrontmatter(noBlock, ['type', 'name'])
    expect(out.startsWith('---\ntype:\nname:\n---\n')).toBe(true)
    expect(out.endsWith('# Just a title\n\nSome prose.\n')).toBe(true)
    // and it parses back to those keys
    const { hasBlock } = parseFrontmatterDoc(out)
    expect(hasBlock).toBe(true)
  })
})
