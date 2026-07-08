/**
 * Tidy a GFM Markdown table's raw source so columns line up in a monospace read:
 * pad every cell to its column width and rebuild the delimiter row, honouring
 * alignment colons (`:--` left, `:-:` center, `--:` right). Pure + testable; the
 * editor finds the block and swaps in the result. Returns null if `block` isn't a
 * table (needs a header row and a `---` delimiter row).
 */

type Align = '' | 'l' | 'r' | 'c'

const isDelimiterRow = (s: string): boolean =>
  s.includes('-') && /^\s*\|?[\s:|-]*\|?\s*$/.test(s) && /-/.test(s)

function splitRow(s: string): string[] {
  let t = s.trim()
  if (t.startsWith('|')) t = t.slice(1)
  if (t.endsWith('|')) t = t.slice(0, -1)
  return t.split('|').map((c) => c.trim())
}

function pad(text: string, width: number, align: Align): string {
  const extra = Math.max(0, width - text.length)
  if (align === 'r') return ' '.repeat(extra) + text
  if (align === 'c') {
    const left = Math.floor(extra / 2)
    return ' '.repeat(left) + text + ' '.repeat(extra - left)
  }
  return text + ' '.repeat(extra)
}

export function tidyTableBlock(block: string): string | null {
  const lines = block.split('\n')
  if (lines.length < 2 || !isDelimiterRow(lines[1])) return null

  const header = splitRow(lines[0])
  const delim = splitRow(lines[1])
  const body = lines.slice(2).map(splitRow)
  const cols = Math.max(header.length, delim.length, ...body.map((r) => r.length))

  const aligns: Align[] = []
  for (let i = 0; i < cols; i++) {
    const d = (delim[i] ?? '').trim()
    const left = d.startsWith(':')
    const right = d.endsWith(':')
    aligns[i] = left && right ? 'c' : right ? 'r' : left ? 'l' : ''
  }

  const widths: number[] = []
  for (let i = 0; i < cols; i++) {
    let w = 3 // room for at least '---'
    for (const row of [header, ...body]) w = Math.max(w, (row[i] ?? '').length)
    widths[i] = w
  }

  const renderRow = (cells: string[]): string =>
    '| ' +
    Array.from({ length: cols }, (_, i) =>
      pad(cells[i] ?? '', widths[i], aligns[i])
    ).join(' | ') +
    ' |'

  const renderDelim = (): string =>
    '| ' +
    Array.from({ length: cols }, (_, i) => {
      const w = widths[i]
      switch (aligns[i]) {
        case 'c':
          return ':' + '-'.repeat(w - 2) + ':'
        case 'r':
          return '-'.repeat(w - 1) + ':'
        case 'l':
          return ':' + '-'.repeat(w - 1)
        default:
          return '-'.repeat(w)
      }
    }).join(' | ') +
    ' |'

  return [renderRow(header), renderDelim(), ...body.map(renderRow)].join('\n')
}
