import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

interface HelpProps {
  projectRoot: string
  projectName: string
  onClose: () => void
}

type Shortcut = { keys: string; desc: string }
type SyntaxRow = { syntax: string; desc: string }

const SHORTCUTS: Shortcut[] = [
  { keys: '⌘P', desc: 'Quick Open — jump to any file (fuzzy; matches folder too)' },
  { keys: '⌘⇧P', desc: 'Command Palette — run any command' },
  { keys: '⌘S', desc: 'Save the current file' },
  { keys: '⌘W', desc: 'Close the current tab' },
  { keys: 'Ctrl+Tab', desc: 'Cycle tabs (⌘1–9 jumps to a tab)' },
  { keys: '⌘F', desc: 'Find in the current file' },
  { keys: '⌘⇧F', desc: 'Find across the whole project' },
  { keys: '⌘[  /  ⌘]', desc: 'Back / forward through visited files' },
  { keys: '⌘B / ⌘I / ⌘K', desc: 'Bold / italic / insert link' },
  { keys: '⌘⇧E', desc: 'Focus the file explorer' },
  { keys: 'Esc', desc: 'Close a dialog, palette, or panel' }
]

const MARKDOWN: SyntaxRow[] = [
  { syntax: '# Heading', desc: 'Heading (## and ### go smaller)' },
  { syntax: '**bold**  _italic_', desc: 'Emphasis (⌘B / ⌘I)' },
  { syntax: '`code`  ~~strike~~', desc: 'Inline code · strikethrough' },
  { syntax: '- item   1. item', desc: 'Bullet / numbered list' },
  { syntax: '> quote', desc: 'Block quote' },
  { syntax: '[text](url)', desc: 'Link (⌘K)' },
  { syntax: '![alt](image.png)', desc: 'Image (renders inline; drag one in to insert)' }
]

const WRITER: SyntaxRow[] = [
  {
    syntax: '@{Irene Adler}',
    desc: 'Mention an entity — type @ and pick. ⌘-click a mention to jump to its profile.'
  },
  { syntax: '%% note %%', desc: 'A private note — dimmed, just for you.' },
  {
    syntax: '{==highlight==}  {>>comment<<}',
    desc: 'Highlight a span · leave an editorial comment (hover to read).'
  },
  {
    syntax: '{++insert++}  {--delete--}  {~~old~>new~~}',
    desc: 'Tracked changes — Accept/Reject at the cursor from the palette.'
  },
  {
    syntax: 'type: character',
    desc: 'Frontmatter (the --- block up top): marks a file as an entity.'
  },
  { syntax: 'aliases: [Irene, the woman]', desc: 'Other names a mention can match.' },
  { syntax: 'threads: [the-case]', desc: 'Storylines a scene belongs to.' },
  { syntax: 'order: 10', desc: "A scene's manuscript position." }
]

function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="help__kbd">{children}</kbd>
}

function SyntaxTable({ rows }: { rows: SyntaxRow[] }) {
  return (
    <dl className="help__syntax">
      {rows.map((r) => (
        <div key={r.syntax} className="help__syntax-row">
          <dt>
            <code>{r.syntax}</code>
          </dt>
          <dd>{r.desc}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * In-app Help — a sectioned guide to every feature, plus a ready-to-paste config
 * for connecting Claude (Desktop / Code) to this project over MCP. Opened from
 * the Editor menu, the toolbar “?”, or the palette.
 */
export function Help({ projectRoot, projectName, onClose }: HelpProps) {
  const [section, setSection] = useState('start')
  const [appDir, setAppDir] = useState('')
  const [appVersion, setAppVersion] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    void window.api.getAppDir().then(setAppDir)
    void window.api.getAppVersion().then(setAppVersion)
  }, [])

  const mcpConfig = useMemo(() => {
    const dir = appDir || '/path/to/writer-gui'
    return JSON.stringify(
      {
        mcpServers: {
          'writer-gui': {
            command: `${dir}/node_modules/.bin/tsx`,
            args: [`${dir}/src/mcp/server.ts`, '--root', projectRoot]
          }
        }
      },
      null,
      2
    )
  }, [appDir, projectRoot])

  const copyConfig = () => {
    void navigator.clipboard.writeText(mcpConfig).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const sections: { id: string; label: string; body: ReactNode }[] = [
    {
      id: 'start',
      label: 'Getting started',
      body: (
        <>
          <p>
            SomedayWriter keeps your work as plain <code>.md</code> files on disk. A
            folder becomes a <strong>project</strong> when it has a{' '}
            <code>project.json</code> (edit it any time from the file tree or
            <em> View → Project settings…</em>).
          </p>
          <ul>
            <li>
              <strong>Open / create</strong> a project from the welcome screen or the{' '}
              <em>New… / Open…</em> menu.
            </li>
            <li>
              <strong>Files &amp; tabs</strong> — click a file to open it in a tab; drag
              tabs to reorder; edits are kept per-tab until you save (<Kbd>⌘S</Kbd>).
            </li>
            <li>
              <strong>Get around</strong> with Quick Open (<Kbd>⌘P</Kbd>) and the Command
              Palette (<Kbd>⌘⇧P</Kbd>).
            </li>
            <li>
              <strong>Make it yours</strong> — themes, accent, focus mode, and fonts live
              in the <em>View</em> and <em>Editor</em> menus.
            </li>
          </ul>
        </>
      )
    },
    {
      id: 'keys',
      label: 'Keyboard shortcuts',
      body: (
        <>
          <p className="help__muted">On Windows/Linux, use Ctrl in place of ⌘.</p>
          <div className="help__keys">
            {SHORTCUTS.map((s) => (
              <div key={s.keys} className="help__keys-row">
                <span className="help__keys-combo">
                  {s.keys.split(/\s+/).map((k, i) => (
                    <Kbd key={i}>{k}</Kbd>
                  ))}
                </span>
                <span>{s.desc}</span>
              </div>
            ))}
          </div>
        </>
      )
    },
    {
      id: 'syntax',
      label: 'Writing & syntax',
      body: (
        <>
          <h4 className="help__subhead">Markdown</h4>
          <SyntaxTable rows={MARKDOWN} />
          <h4 className="help__subhead">Writer syntax</h4>
          <SyntaxTable rows={WRITER} />
        </>
      )
    },
    {
      id: 'story',
      label: 'Story intelligence',
      body: (
        <ul>
          <li>
            <strong>Entities</strong> — any file with a <code>type:</code> in its
            frontmatter (characters, locations, items, factions, threads…). Reference them
            with <code>@{'{Name}'}</code> mentions.
          </li>
          <li>
            <strong>Find references / go to definition</strong> — see everywhere an entity
            is mentioned, and ⌘-click a mention to open its profile.
          </li>
          <li>
            <strong>Panels</strong> (right rail): <em>Companion</em> follows the current
            scene's entities, <em>Inspector</em> shows what the app parses,
            <em> References</em> browses everything, <em>Threads</em> + <em>Timeline</em>{' '}
            visualise storylines.
          </li>
          <li>
            <strong>Project Health</strong> flags <code>@{'{…}'}</code> mentions that no
            longer resolve; renaming an entity offers to update its mentions everywhere.
          </li>
          <li>
            <strong>Editorial marks</strong> — highlights, comments, and tracked changes
            (see the Writing &amp; syntax section); the <em>Comments</em> panel lists them
            all.
          </li>
        </ul>
      )
    },
    {
      id: 'grammar',
      label: 'Spelling & grammar',
      body: (
        <>
          <p>
            Spelling squiggles are <strong>off by default</strong> — toggle{' '}
            <em>Editor → Diagnostics</em>. For real grammar/style, connect{' '}
            <strong>LanguageTool</strong> (self-hostable, so prose stays on-device) by
            adding a <code>grammar</code> block to your app <code>settings.json</code>:
          </p>
          <pre className="help__code">{`"grammar": {
  "enabled": true,
  "url": "http://localhost:8081",   // a LanguageTool server
  "language": "en-US"
}`}</pre>
          <p className="help__muted">
            Or attach a live language server instead with{' '}
            <code>
              "lsp": {'{'} "command": ["ltex-ls"] {'}'}
            </code>
            . The API key (if any) stays in the app's main process — never in the editor.
          </p>
        </>
      )
    },
    {
      id: 'claude',
      label: 'Connect Claude (AI)',
      body: (
        <>
          <p>
            SomedayWriter ships an <strong>MCP server</strong> so{' '}
            <strong>Claude Desktop or Claude Code</strong> can read and reason over{' '}
            <em>this</em> manuscript — on your subscription, with no API key and no AI
            code in the app. Ask things like <em>“summarise the the-case thread”</em> or{' '}
            <em>“where is Irene Adler mentioned?”</em> and Claude answers from the real
            index.
          </p>
          <ol className="help__steps">
            <li>
              Open your client's MCP config — in Claude Desktop:{' '}
              <em>Settings → Developer → Edit Config</em>.
            </li>
            <li>Add the server below (already filled in for “{projectName}”):</li>
          </ol>
          <div className="help__code-wrap">
            <button className="help__copy" onClick={copyConfig}>
              {copied ? 'Copied!' : 'Copy'}
            </button>
            <pre className="help__code">{mcpConfig}</pre>
          </div>
          <p className="help__muted">
            Restart the client, then look for the <strong>writer-gui</strong> tools. It
            exposes your files as resources plus tools like <code>find_references</code>,{' '}
            <code>thread_beats</code>, and a root-guarded <code>write_file</code>.
          </p>
        </>
      )
    }
  ]

  const active = sections.find((s) => s.id === section) ?? sections[0]

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div className="help" onMouseDown={(e) => e.stopPropagation()}>
        <div className="help__header">
          <span className="help__heading">
            Help
            {appVersion && (
              <span
                className="help__version"
                title="Preview build — use at your own risk. Back up your work."
              >
                v{appVersion} · preview
              </span>
            )}
          </span>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <div className="help__body">
          <nav className="help__nav">
            {sections.map((s) => (
              <button
                key={s.id}
                className={`help__nav-item${s.id === section ? ' help__nav-item--active' : ''}`}
                onClick={() => setSection(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>
          <div className="help__content">
            <h3 className="help__content-title">{active.label}</h3>
            {active.body}
          </div>
        </div>
      </div>
    </div>
  )
}
