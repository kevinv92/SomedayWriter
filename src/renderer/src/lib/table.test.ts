import { describe, expect, it } from 'vitest'
import { tidyTableBlock } from './table'

describe('tidyTableBlock', () => {
  it('pads columns so every row is the same width', () => {
    const out = tidyTableBlock(
      ['| Name | Role |', '| :-- | --: |', '| Holmes | detective |'].join('\n')
    )
    expect(out).not.toBeNull()
    const lines = out!.split('\n')
    expect(lines).toHaveLength(3)
    const widths = new Set(lines.map((l) => l.length))
    expect(widths.size).toBe(1) // all rows aligned to one width
  })

  it('honours alignment colons in the delimiter row', () => {
    const out = tidyTableBlock(
      ['| A | B | C |', '| :-- | :-: | --: |', '| x | y | z |'].join('\n')
    )!
    const delim = out.split('\n')[1]
    const cells = delim
      .split('|')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(cells[0].startsWith(':')).toBe(true) // left
    expect(cells[0].endsWith(':')).toBe(false)
    expect(cells[1].startsWith(':') && cells[1].endsWith(':')).toBe(true) // center
    expect(cells[2].startsWith(':')).toBe(false) // right
    expect(cells[2].endsWith(':')).toBe(true)
  })

  it('returns null when the block is not a table', () => {
    expect(tidyTableBlock('just a line')).toBeNull()
    expect(tidyTableBlock('| header only |')).toBeNull()
    expect(tidyTableBlock('| a | b |\nnot a delimiter\n| x | y |')).toBeNull()
  })
})
