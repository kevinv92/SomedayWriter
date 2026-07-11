/**
 * Shared manuscript typography — one source of the reading stylesheet + HTML
 * rendering used by every non-plaintext export target. EPUB pulls `READING_CSS`
 * + `escHtml` for its per-chapter XHTML; PDF renders a whole `renderManuscriptDocument`
 * and prints it. (docx doesn't use HTML — it walks Markdown tokens — so it isn't
 * here.) No Electron/fs: give it clean scene markdown, get HTML/strings back.
 */
import { marked } from 'marked'
import type { SceneSeparator } from '../shared/manuscript'

/** The serif reading stylesheet — the "finished page" look shared by EPUB + PDF.
 *  Page-size/margins are NOT set here: PDF passes them to `printToPDF`, so the
 *  same HTML prints at any size. */
export const READING_CSS = `
body { font-family: Georgia, 'Iowan Old Style', serif; line-height: 1.6; margin: 0; }
h1 { font-size: 1.6em; margin: 1.2em 0 0.6em; line-height: 1.2; }
h2 { font-size: 1.3em; margin: 1.2em 0 0.5em; }
p { margin: 0 0 0.9em; text-indent: 0; }
p + p { text-indent: 1.4em; margin-top: 0; }
blockquote { margin: 1em 1.5em; font-style: italic; }
hr { border: 0; text-align: center; margin: 1.5em 0; }
hr:after { content: '* * *'; letter-spacing: 0.4em; }
em { font-style: italic; }
strong { font-weight: bold; }
.titlepage { text-align: center; margin-top: 33vh; break-after: page; page-break-after: always; }
.titlepage h1 { font-size: 2.2em; margin: 0 0 0.4em; }
.titlepage .byline { font-style: italic; color: #555; margin: 0; }
.scene--break { break-before: page; page-break-before: always; }
`.trim()

/** XML/HTML entity-escape raw text (titles, author) before injecting into markup. */
export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** One rendered scene: its nav/TOC title plus its already-stripped Markdown. */
export interface ManuscriptChapter {
  title: string
  markdown: string
}

export interface ManuscriptDocMeta {
  title: string
  author?: string
}

export interface ManuscriptDocOptions {
  titlePage: boolean
  sceneTitles: boolean
  separator: SceneSeparator
}

/** Render the whole manuscript as one self-contained HTML document (for PDF).
 *  Title page + one `<section class="scene">` per chapter, joined per the
 *  separator (`* * *` rule, or a page break, or nothing). */
export function renderManuscriptDocument(
  meta: ManuscriptDocMeta,
  chapters: ManuscriptChapter[],
  opts: ManuscriptDocOptions
): string {
  const titlePage =
    opts.titlePage && meta.title
      ? `<section class="titlepage"><h1>${escHtml(meta.title)}</h1>${
          meta.author ? `<p class="byline">by ${escHtml(meta.author)}</p>` : ''
        }</section>`
      : ''

  const sections = chapters.map((ch, i) => {
    const head = opts.sceneTitles && ch.title ? `<h1>${escHtml(ch.title)}</h1>\n` : ''
    // A page break falls *between* scenes (and after the title page), never
    // before the very first block on the first page.
    const brk =
      opts.separator === 'pagebreak' && (i > 0 || titlePage) ? ' scene--break' : ''
    return `<section class="scene${brk}">\n${head}${marked.parse(ch.markdown)}\n</section>`
  })

  const body =
    opts.separator === 'stars'
      ? sections.join('\n<hr class="scene-sep" />\n')
      : sections.join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escHtml(meta.title)}</title>
<style>${READING_CSS}
body { padding: 0 1em; }
</style>
</head>
<body>
${titlePage}
${body}
</body>
</html>`
}
