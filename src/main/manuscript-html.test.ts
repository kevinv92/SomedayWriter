import { describe, it, expect } from 'vitest'
import { escHtml, renderManuscriptDocument } from './manuscript-html'

const chapters = [
  { title: 'The Woman', markdown: 'To **Sherlock** she is the woman.' },
  { title: 'The King', markdown: 'A second scene.' }
]

describe('escHtml', () => {
  it('escapes the XML/HTML special characters', () => {
    expect(escHtml('a & <b> "c" \'d\'')).toBe(
      'a &amp; &lt;b&gt; &quot;c&quot; &#39;d&#39;'
    )
  })
})

describe('renderManuscriptDocument', () => {
  it('renders a title page and per-scene headings + inline emphasis', () => {
    const html = renderManuscriptDocument(
      { title: 'A Scandal', author: 'Doyle' },
      chapters,
      {
        titlePage: true,
        sceneTitles: true,
        separator: 'blank'
      }
    )
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true)
    expect(html).toContain('class="titlepage"')
    expect(html).toContain('A Scandal')
    expect(html).toContain('by Doyle')
    expect(html).toContain('<h1>The Woman</h1>')
    expect(html).toContain('<strong>Sherlock</strong>')
  })

  it('breaks between scenes (not before the first) for pagebreak', () => {
    const html = renderManuscriptDocument({ title: 'X' }, chapters, {
      titlePage: false,
      sceneTitles: false,
      separator: 'pagebreak'
    })
    const sections = html.match(/<section class="scene[^"]*"/g) ?? []
    expect(sections[0]).toBe('<section class="scene"')
    expect(sections[1]).toContain('scene--break')
  })

  it('breaks the first scene too when a title page precedes it', () => {
    const html = renderManuscriptDocument({ title: 'Book' }, chapters, {
      titlePage: true,
      sceneTitles: false,
      separator: 'pagebreak'
    })
    const sections = html.match(/<section class="scene[^"]*"/g) ?? []
    expect(sections[0]).toContain('scene--break')
  })

  it('inserts hr separators for the stars separator', () => {
    const html = renderManuscriptDocument({ title: 'X' }, chapters, {
      titlePage: false,
      sceneTitles: false,
      separator: 'stars'
    })
    expect(html).toContain('<hr class="scene-sep"')
  })

  it('omits the title page when disabled', () => {
    const html = renderManuscriptDocument({ title: 'X' }, chapters, {
      titlePage: false,
      sceneTitles: false,
      separator: 'blank'
    })
    expect(html).not.toContain('class="titlepage"')
  })
})
