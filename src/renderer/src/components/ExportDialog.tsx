import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  DEFAULT_EXPORT_OPTIONS,
  type ExportFormat,
  type ExportOptions,
  type SceneSeparator
} from '@shared/manuscript'

const FORMATS: { id: ExportFormat; label: string }[] = [
  { id: 'markdown', label: 'Markdown' },
  { id: 'epub', label: 'EPUB' },
  { id: 'docx', label: 'Word' },
  { id: 'pdf', label: 'PDF' }
]

interface ExportDialogProps {
  /** Pre-select a format (a per-format menu item opened the dialog). */
  initialFormat?: ExportFormat
  /** Whether a file is open — enables the "this file only" scope. */
  hasActiveFile: boolean
  onExport: (options: ExportOptions) => void
  onClose: () => void
}

/** One label + control row. */
function Row({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}): ReactNode {
  return (
    <div className="export__row">
      <div className="export__row-t">
        <span>{label}</span>
        {hint && <small>{hint}</small>}
      </div>
      {children}
    </div>
  )
}

/** A two-or-more-way segmented control. */
function Seg<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: [T, string][]
  onChange: (v: T) => void
}): ReactNode {
  return (
    <div className="export__seg">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={`export__seg-btn${value === v ? ' is-on' : ''}`}
          onClick={() => onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): ReactNode {
  return (
    <button
      className={`export__sw${on ? ' is-on' : ''}`}
      role="switch"
      aria-checked={on}
      onClick={onClick}
    />
  )
}

/** The Export dialog — one surface for Markdown / EPUB / Word / PDF with shared
 *  options (design: spec/todo/export.md). Compiling + saving happens in main via
 *  `export:run`; this only collects options. */
export function ExportDialog({
  initialFormat,
  hasActiveFile,
  onExport,
  onClose
}: ExportDialogProps): ReactNode {
  const [opts, setOpts] = useState<ExportOptions>(() => ({
    ...DEFAULT_EXPORT_OPTIONS,
    format: initialFormat ?? DEFAULT_EXPORT_OPTIONS.format
  }))
  const [summary, setSummary] = useState<{ scenes: number; words: number } | null>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)

  const set = <K extends keyof ExportOptions>(k: K, v: ExportOptions[K]): void =>
    setOpts((o) => ({ ...o, [k]: v }))

  const paged = opts.format === 'pdf' || opts.format === 'docx'
  // A page break only means something in a paged format; fall back to a blank
  // line so the (now hidden) option can't linger and confuse the compile.
  const separator: SceneSeparator =
    !paged && opts.separator === 'pagebreak' ? 'blank' : opts.separator

  useEffect(() => {
    primaryRef.current?.focus()
    let alive = true
    void window.api.storyManuscriptScenes().then((scenes) => {
      if (!alive) return
      setSummary({
        scenes: scenes.length,
        words: scenes.reduce((n, s) => n + s.words, 0)
      })
    })
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('select')) {
        e.preventDefault()
        onExport({ ...opts, separator })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [opts, separator, onExport, onClose])

  return (
    <div className="modal-overlay" onMouseDown={onClose}>
      <div
        className="export"
        role="dialog"
        aria-label="Export"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="export__head">
          <h2 className="export__title">Export</h2>
          <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
            ✕
          </button>
        </header>

        <div className="export__body">
          <section className="export__sec">
            <p className="export__label">Format</p>
            <div className="export__fmt">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  className={`export__fmt-btn${opts.format === f.id ? ' is-on' : ''}`}
                  onClick={() => set('format', f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </section>

          <section className="export__sec">
            <p className="export__label">Content</p>
            <Row label="Tracked changes" hint="How to resolve suggested edits">
              <Seg
                value={opts.changes}
                options={[
                  ['accept', 'Accept'],
                  ['reject', 'Reject']
                ]}
                onChange={(v) => set('changes', v)}
              />
            </Row>
            <Row label="Scene titles as headings">
              <Toggle
                on={opts.sceneTitles}
                onClick={() => set('sceneTitles', !opts.sceneTitles)}
              />
            </Row>
            <Row label="Scene separator">
              <select
                className="export__select"
                value={separator}
                onChange={(e) => set('separator', e.target.value as SceneSeparator)}
              >
                {paged && <option value="pagebreak">Page break</option>}
                <option value="stars">* * *</option>
                <option value="blank">Blank line</option>
              </select>
            </Row>
            <Row label="Title page" hint="Title & author from the project">
              <Toggle
                on={opts.titlePage}
                onClick={() => set('titlePage', !opts.titlePage)}
              />
            </Row>
            <Row label="Include">
              <select
                className="export__select"
                value={opts.scope}
                onChange={(e) => set('scope', e.target.value as ExportOptions['scope'])}
              >
                <option value="manuscript">Whole manuscript</option>
                <option value="file" disabled={!hasActiveFile}>
                  This file only
                </option>
              </select>
            </Row>
          </section>

          {opts.format === 'pdf' && (
            <section className="export__sec export__sec--paged">
              <p className="export__label">Page (PDF)</p>
              <Row label="Page size">
                <Seg
                  value={opts.pageSize}
                  options={[
                    ['A4', 'A4'],
                    ['Letter', 'Letter']
                  ]}
                  onChange={(v) => set('pageSize', v)}
                />
              </Row>
              <Row label="Margins">
                <Seg
                  value={opts.margins}
                  options={[
                    ['normal', 'Normal'],
                    ['wide', 'Wide']
                  ]}
                  onChange={(v) => set('margins', v)}
                />
              </Row>
            </section>
          )}
        </div>

        <footer className="export__foot">
          <span className="export__summary">
            {summary &&
              (opts.scope === 'file' ? (
                'This file only'
              ) : (
                <>
                  <b>{summary.scenes}</b> scene{summary.scenes === 1 ? '' : 's'} · ~
                  <b>{summary.words.toLocaleString()}</b> words
                </>
              ))}
          </span>
          <div className="export__btns">
            <button className="export__btn" onClick={onClose}>
              Cancel
            </button>
            <button
              ref={primaryRef}
              className="export__btn export__btn--primary"
              onClick={() => onExport({ ...opts, separator })}
            >
              Export…
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
