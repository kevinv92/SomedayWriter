import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { buildDocx } from './docx'

async function documentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf)
  return zip.file('word/document.xml')!.async('string')
}

describe('buildDocx', () => {
  it('renders a valid .docx with title page, prose, and emphasis runs', async () => {
    const buf = await buildDocx(
      { title: 'A Scandal', author: 'A. C. Doyle' },
      [
        {
          title: 'The Woman',
          markdown: '# The Woman\n\nTo **Sherlock** she is *always* the woman.'
        }
      ],
      { titlePage: true, sceneTitles: true, separator: 'blank' }
    )
    expect(buf.subarray(0, 2).toString()).toBe('PK') // a zip (docx)
    const xml = await documentXml(buf)
    expect(xml).toContain('A Scandal')
    expect(xml).toContain('A. C. Doyle')
    expect(xml).toContain('Sherlock')
    expect(xml).toContain('always')
    expect(xml).toContain('The Woman')
    expect(xml).toMatch(/<w:b\s*\/?>/) // a bold run
    expect(xml).toMatch(/<w:i\s*\/?>/) // an italic run
  })

  it('inserts a page break between scenes for the pagebreak separator', async () => {
    const buf = await buildDocx(
      { title: 'X' },
      [
        { title: 'One', markdown: 'First scene.' },
        { title: 'Two', markdown: 'Second scene.' }
      ],
      { titlePage: false, sceneTitles: false, separator: 'pagebreak' }
    )
    const xml = await documentXml(buf)
    expect(xml).toMatch(/w:type="page"/)
    expect(xml).toContain('First scene.')
    expect(xml).toContain('Second scene.')
  })

  it('renders a centred * * * for the stars separator', async () => {
    const buf = await buildDocx(
      { title: 'X' },
      [
        { title: 'One', markdown: 'First.' },
        { title: 'Two', markdown: 'Second.' }
      ],
      { titlePage: false, sceneTitles: false, separator: 'stars' }
    )
    expect(await documentXml(buf)).toContain('* * *')
  })

  it('maps blockquotes and lists without throwing', async () => {
    const buf = await buildDocx(
      { title: 'X' },
      [{ title: 'S', markdown: '> a quote\n\n- one\n- two\n\n1. first\n2. second' }],
      { titlePage: false, sceneTitles: false, separator: 'blank' }
    )
    const xml = await documentXml(buf)
    expect(xml).toContain('a quote')
    expect(xml).toContain('first')
  })
})
