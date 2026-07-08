import { useEffect } from 'react'
import { Icon } from './Icon'

type Row = { syntax: string; desc: string }

const MARKDOWN: Row[] = [
  { syntax: '# Heading', desc: 'Heading (## and ### go smaller)' },
  { syntax: '**bold**', desc: 'Bold  ·  ⌘/Ctrl+B' },
  { syntax: '_italic_', desc: 'Italic  ·  ⌘/Ctrl+I' },
  { syntax: '~~strike~~', desc: 'Strikethrough' },
  { syntax: '`code`', desc: 'Inline monospace' },
  { syntax: '- item', desc: 'Bullet list' },
  { syntax: '1. item', desc: 'Numbered list' },
  { syntax: '> quote', desc: 'Block quote' },
  { syntax: '[text](url)', desc: 'Link  ·  ⌘/Ctrl+K' },
  { syntax: '---', desc: 'Horizontal rule' }
]

const WRITER: Row[] = [
  {
    syntax: '@{Mara}',
    desc: 'Mention an entity (or just type its name). ⌘/Ctrl-click a mention to jump to its profile.'
  },
  { syntax: '%% note %%', desc: 'A private note — dimmed in the editor, just for you.' },
  {
    syntax: '{>>comment<<}',
    desc: 'An editorial comment (hover to read it). Wrap a span with {==…==} to anchor it. Stripped on export.'
  },
  {
    syntax: '{++insert++} {--delete--}',
    desc: 'Suggested edits (tracked changes). {~~old~>new~~} substitutes. Accept/Reject at cursor from the palette.'
  },
  {
    syntax: 'type: character',
    desc: 'Frontmatter (in the --- block at the top): marks a file as an entity.'
  },
  { syntax: 'aliases: [Mara, the courier]', desc: 'Other names a mention can match.' },
  {
    syntax: 'threads: [rebellion, romance]',
    desc: 'Storylines a scene belongs to (see the Threads panel).'
  },
  { syntax: 'order: 10', desc: 'Manuscript position of a scene.' },
  {
    syntax: '<!-- thread:rebellion -->',
    desc: 'Inline marker — also joins this scene to a thread (scope a span with a matching <!-- /thread -->).'
  }
]

function Table({ title, rows }: { title: string; rows: Row[] }) {
  return (
    <section className="syntax-help__section">
      <h3 className="syntax-help__title">{title}</h3>
      <dl className="syntax-help__list">
        {rows.map((r) => (
          <div key={r.syntax} className="syntax-help__row">
            <dt>
              <code>{r.syntax}</code>
            </dt>
            <dd>{r.desc}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** A quick reference (cheat sheet) for Markdown + writer-gui's own syntax — so
 * writers who don't know Markdown, or the app's mentions/notes/frontmatter, have
 * it at hand. Opened from the toolbar's “?”, the View menu, or the palette. */
export function SyntaxHelp({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="syntax-help" onMouseDown={(e) => e.stopPropagation()}>
        <div className="syntax-help__header">
          <span className="syntax-help__heading">Markdown &amp; syntax reference</span>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="syntax-help__body">
          <Table title="Formatting" rows={MARKDOWN} />
          <Table title="Writer syntax" rows={WRITER} />
        </div>
      </div>
    </div>
  )
}
