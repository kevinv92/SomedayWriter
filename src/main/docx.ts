/**
 * Word (.docx) export — map the manuscript's Markdown to a Word document via the
 * `docx` library (no external binary, same "own the pipeline" stance as EPUB).
 * We walk marked's token stream rather than its HTML, so styling maps to real
 * Word runs/paragraphs. Scenes arrive already stripped (see manuscript.ts).
 */
import {
  AlignmentType,
  Document,
  HeadingLevel,
  LevelFormat,
  Packer,
  PageBreak,
  Paragraph,
  TextRun,
  convertInchesToTwip
} from 'docx'
import { marked, type Token, type Tokens } from 'marked'
import type {
  ManuscriptChapter,
  ManuscriptDocMeta,
  ManuscriptDocOptions
} from './manuscript-html'

const HEADINGS = [
  HeadingLevel.HEADING_1,
  HeadingLevel.HEADING_2,
  HeadingLevel.HEADING_3,
  HeadingLevel.HEADING_4,
  HeadingLevel.HEADING_5,
  HeadingLevel.HEADING_6
]

interface RunStyle {
  bold?: boolean
  italics?: boolean
  strike?: boolean
  font?: string
}

/** Minimal entity decode — marked leaves a handful escaped in text tokens. */
function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

/** Flatten inline tokens into styled Word runs, carrying emphasis down. */
function inlineRuns(tokens: Token[] = [], style: RunStyle = {}): TextRun[] {
  const out: TextRun[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'text': {
        const tk = t as Tokens.Text
        if (tk.tokens && tk.tokens.length) out.push(...inlineRuns(tk.tokens, style))
        else out.push(new TextRun({ text: decode(tk.text), ...style }))
        break
      }
      case 'strong':
        out.push(...inlineRuns((t as Tokens.Strong).tokens, { ...style, bold: true }))
        break
      case 'em':
        out.push(...inlineRuns((t as Tokens.Em).tokens, { ...style, italics: true }))
        break
      case 'del':
        out.push(...inlineRuns((t as Tokens.Del).tokens, { ...style, strike: true }))
        break
      case 'codespan':
        out.push(
          new TextRun({
            text: decode((t as Tokens.Codespan).text),
            font: 'Courier New',
            ...style
          })
        )
        break
      case 'link':
        out.push(...inlineRuns((t as Tokens.Link).tokens, style))
        break
      case 'br':
        out.push(new TextRun({ break: 1 }))
        break
      case 'escape':
        out.push(new TextRun({ text: (t as Tokens.Escape).text, ...style }))
        break
      default: {
        const raw = (t as { text?: string }).text
        if (raw) out.push(new TextRun({ text: decode(raw), ...style }))
      }
    }
  }
  return out
}

/** A scene break line: centred `* * *`. */
function sceneBreak(): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 240 },
    children: [new TextRun('* * *')]
  })
}

/** Collapse a list item's block tokens down to inline runs (handles the common
 *  single-line item; nested blocks degrade to their text). */
function listItemRuns(item: Tokens.ListItem): TextRun[] {
  const runs: TextRun[] = []
  for (const b of item.tokens) {
    if (b.type === 'text') {
      const tb = b as Tokens.Text
      runs.push(
        ...inlineRuns(tb.tokens ?? [{ type: 'text', raw: tb.text, text: tb.text }])
      )
    } else if (b.type === 'paragraph') {
      runs.push(...inlineRuns((b as Tokens.Paragraph).tokens))
    } else {
      const raw = (b as { text?: string }).text
      if (raw) runs.push(new TextRun(decode(raw)))
    }
  }
  return runs
}

/** Map a scene's block tokens to Word paragraphs. */
function blockParagraphs(tokens: Token[]): Paragraph[] {
  const out: Paragraph[] = []
  for (const t of tokens) {
    switch (t.type) {
      case 'heading': {
        const h = t as Tokens.Heading
        out.push(
          new Paragraph({
            heading: HEADINGS[Math.min(Math.max(h.depth, 1), 6) - 1],
            children: inlineRuns(h.tokens)
          })
        )
        break
      }
      case 'paragraph':
        out.push(new Paragraph({ children: inlineRuns((t as Tokens.Paragraph).tokens) }))
        break
      case 'blockquote': {
        for (const inner of (t as Tokens.Blockquote).tokens) {
          if (inner.type === 'paragraph') {
            out.push(
              new Paragraph({
                indent: { left: convertInchesToTwip(0.5) },
                children: inlineRuns((inner as Tokens.Paragraph).tokens, {
                  italics: true
                })
              })
            )
          } else {
            out.push(...blockParagraphs([inner]))
          }
        }
        break
      }
      case 'list': {
        const list = t as Tokens.List
        list.items.forEach((item) => {
          out.push(
            new Paragraph({
              children: listItemRuns(item),
              ...(list.ordered
                ? { numbering: { reference: 'ol', level: 0 } }
                : { bullet: { level: 0 } })
            })
          )
        })
        break
      }
      case 'code':
        out.push(
          new Paragraph({
            children: [
              new TextRun({ text: (t as Tokens.Code).text, font: 'Courier New' })
            ]
          })
        )
        break
      case 'hr':
        out.push(sceneBreak())
        break
      case 'space':
        break
      default: {
        const raw = (t as { text?: string }).text
        if (raw) out.push(new Paragraph({ children: [new TextRun(decode(raw))] }))
      }
    }
  }
  return out
}

/** Build a .docx manuscript as a Buffer. Page is a standard Letter/1in — the
 *  export dialog's page controls are PDF-only. */
export async function buildDocx(
  meta: ManuscriptDocMeta,
  chapters: ManuscriptChapter[],
  opts: ManuscriptDocOptions
): Promise<Buffer> {
  const children: Paragraph[] = []

  const hasTitlePage = opts.titlePage && !!meta.title
  if (hasTitlePage) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 3200, after: 240 },
        children: [new TextRun({ text: meta.title, bold: true, size: 48 })]
      })
    )
    if (meta.author) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: `by ${meta.author}`, italics: true, size: 28 })]
        })
      )
    }
    children.push(new Paragraph({ children: [new PageBreak()] }))
  }

  chapters.forEach((ch, i) => {
    if (opts.separator === 'pagebreak' && i > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    if (opts.sceneTitles && ch.title) {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          children: [new TextRun(ch.title)]
        })
      )
    }
    children.push(...blockParagraphs(marked.lexer(ch.markdown)))
    if (opts.separator === 'stars' && i < chapters.length - 1) children.push(sceneBreak())
  })

  const doc = new Document({
    creator: meta.author || 'SomedayWriter',
    title: meta.title,
    numbering: {
      config: [
        {
          reference: 'ol',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.START
            }
          ]
        }
      ]
    },
    sections: [{ children }]
  })

  return Packer.toBuffer(doc)
}
