import JSZip from 'jszip'
import { marked } from 'marked'
import { READING_CSS, escHtml as esc } from './manuscript-html'

/** One chapter: a nav/TOC title plus the scene's (already stripped) Markdown. */
export interface EpubChapter {
  title: string
  markdown: string
}

export interface EpubMeta {
  title: string
  author?: string
  language?: string
  /** A unique book id, e.g. `urn:uuid:<uuid>`. Caller supplies it (main has
   *  crypto); required by the OPF `dc:identifier`. */
  identifier: string
}

/** Make marked's HTML5 output well-formed XHTML: self-close void elements so a
 *  strict EPUB parser (epubcheck) accepts it. Attribute values may contain `>`
 *  only inside quotes, which the alternation guards against. */
function xhtmlSafe(html: string): string {
  const VOID = 'area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr'
  return html.replace(
    new RegExp(`<(${VOID})\\b((?:[^>"']|"[^"]*"|'[^']*')*?)\\s*/?>`, 'gi'),
    '<$1$2 />'
  )
}

function chapterXhtml(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>
  <link rel="stylesheet" type="text/css" href="style.css" />
</head>
<body>
${bodyHtml}
</body>
</html>`
}

/** Build an EPUB 3 (with an EPUB 2 `toc.ncx` fallback) as a Buffer. */
export async function buildEpub(
  meta: EpubMeta,
  chapters: EpubChapter[]
): Promise<Buffer> {
  const language = meta.language ?? 'en'
  const files = chapters.map((ch, i) => ({
    id: `chap${i + 1}`,
    href: `chap${i + 1}.xhtml`,
    title: ch.title || `Chapter ${i + 1}`,
    xhtml: chapterXhtml(
      ch.title || `Chapter ${i + 1}`,
      xhtmlSafe(marked.parse(ch.markdown) as string)
    )
  }))

  const manifestItems = files
    .map(
      (f) =>
        `    <item id="${f.id}" href="${f.href}" media-type="application/xhtml+xml" />`
    )
    .join('\n')
  const spineItems = files.map((f) => `    <itemref idref="${f.id}" />`).join('\n')

  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${esc(meta.identifier)}</dc:identifier>
    <dc:title>${esc(meta.title)}</dc:title>
    <dc:language>${esc(language)}</dc:language>
    <dc:creator>${esc(meta.author ?? 'Unknown')}</dc:creator>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml" />
    <item id="style" href="style.css" media-type="text/css" />
${manifestItems}
  </manifest>
  <spine toc="ncx">
${spineItems}
  </spine>
</package>`

  const navList = files
    .map((f) => `      <li><a href="${f.href}">${esc(f.title)}</a></li>`)
    .join('\n')
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${esc(language)}">
<head><meta charset="utf-8" /><title>${esc(meta.title)}</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Contents</h1>
    <ol>
${navList}
    </ol>
  </nav>
</body>
</html>`

  const ncxPoints = files
    .map(
      (f, i) => `    <navPoint id="${f.id}" playOrder="${i + 1}">
      <navLabel><text>${esc(f.title)}</text></navLabel>
      <content src="${f.href}" />
    </navPoint>`
    )
    .join('\n')
  const ncx = `<?xml version="1.0" encoding="utf-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${esc(meta.identifier)}" />
    <meta name="dtb:depth" content="1" />
  </head>
  <docTitle><text>${esc(meta.title)}</text></docTitle>
  <navMap>
${ncxPoints}
  </navMap>
</ncx>`

  const container = `<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`

  const zip = new JSZip()
  // `mimetype` MUST be the first entry and stored uncompressed.
  zip.file('mimetype', 'application/epub+zip', { compression: 'STORE' })
  zip.file('META-INF/container.xml', container)
  const oebps = zip.folder('OEBPS')!
  oebps.file('content.opf', opf)
  oebps.file('nav.xhtml', nav)
  oebps.file('toc.ncx', ncx)
  // READING_CSS is margin-neutral (PDF sets page margins via printToPDF); an EPUB
  // wants its own page inset so text doesn't hug a reader's screen edge.
  oebps.file('style.css', `${READING_CSS}\nbody { margin: 5% 6%; }`)
  for (const f of files) oebps.file(f.href, f.xhtml)

  return zip.generateAsync({ type: 'nodebuffer', mimeType: 'application/epub+zip' })
}
