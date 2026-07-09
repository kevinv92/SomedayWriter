import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { buildEpub } from './epub'

const meta = { title: 'A Scandal', author: 'ACD', identifier: 'urn:uuid:test-id' }
const chapters = [
  { title: 'One', markdown: '# One\n\nThe *woman*, always.' },
  { title: 'Two', markdown: '# Two\n\nA line with a break  \nand more.' }
]

async function openEpub() {
  const buf = await buildEpub(meta, chapters)
  return { buf, zip: await JSZip.loadAsync(buf) }
}

describe('buildEpub', () => {
  it('produces a zip with mimetype first and stored uncompressed', async () => {
    const { buf, zip } = await openEpub()
    const names = Object.keys(zip.files)
    expect(names[0]).toBe('mimetype')
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip')
    // Read the ZIP bytes directly: local file header compression method (offset 8)
    // must be 0 (stored) for the first entry — a strict-EPUB requirement.
    expect(buf.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04])) // PK\x03\x04
    expect(buf.readUInt16LE(8)).toBe(0) // 0 = stored, 8 = deflate
  })

  it('includes the required container, package, nav and ncx files', async () => {
    const { zip } = await openEpub()
    for (const f of [
      'META-INF/container.xml',
      'OEBPS/content.opf',
      'OEBPS/nav.xhtml',
      'OEBPS/toc.ncx',
      'OEBPS/style.css'
    ]) {
      expect(zip.file(f), `missing ${f}`).not.toBeNull()
    }
  })

  it('emits one chapter file per chapter, in the spine and nav', async () => {
    const { zip } = await openEpub()
    expect(zip.file('OEBPS/chap1.xhtml')).not.toBeNull()
    expect(zip.file('OEBPS/chap2.xhtml')).not.toBeNull()
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect((opf.match(/<itemref/g) ?? []).length).toBe(2)
    const nav = await zip.file('OEBPS/nav.xhtml')!.async('string')
    expect(nav).toContain('>One<')
    expect(nav).toContain('>Two<')
  })

  it('renders Markdown to XHTML with void elements self-closed', async () => {
    const { zip } = await openEpub()
    const c1 = await zip.file('OEBPS/chap1.xhtml')!.async('string')
    expect(c1).toContain('<em>woman</em>')
    const c2 = await zip.file('OEBPS/chap2.xhtml')!.async('string')
    // marked emits <br>; the EPUB must be well-formed XML → <br ... />
    expect(c2).toMatch(/<br[^>]*\/>/)
    expect(c2).not.toMatch(/<br>/)
  })

  it('carries the identifier and title into the OPF metadata', async () => {
    const { zip } = await openEpub()
    const opf = await zip.file('OEBPS/content.opf')!.async('string')
    expect(opf).toContain('urn:uuid:test-id')
    expect(opf).toContain('<dc:title>A Scandal</dc:title>')
  })
})
