import { useEffect, useRef, useState } from 'react'
import type { SearchFileResult } from '@shared/types'
import { basename } from '../lib/paths'

interface ProjectSearchProps {
  onClose: () => void
  onOpenMatch: (path: string, line: number, column: number) => void
}

/** Project-wide find & replace (M5, `Cmd/Ctrl+Shift+F`). Searches as you type;
 * clicking a match opens the file at that line; Replace All rewrites matches
 * across the project. */
export function ProjectSearch({ onClose, onOpenMatch }: ProjectSearchProps) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [results, setResults] = useState<SearchFileResult[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Debounced search as you type. All state updates happen inside the timer
  // callback (not synchronously in the effect body) so React is happy.
  useEffect(() => {
    const timer = setTimeout(
      () => {
        void (async () => {
          if (!query) {
            setResults([])
            setStatus(null)
            return
          }
          const found = await window.api.searchProject(query, { caseSensitive })
          setResults(found)
          const total = found.reduce((n, file) => n + file.matches.length, 0)
          setStatus(
            `${total} match${total === 1 ? '' : 'es'} in ${found.length} file${
              found.length === 1 ? '' : 's'
            }`
          )
        })()
      },
      query ? 200 : 0
    )
    return () => clearTimeout(timer)
  }, [query, caseSensitive])

  const replaceAll = async () => {
    if (!query) return
    const result = await window.api.replaceInProject(query, replacement, {
      caseSensitive
    })
    if (!result.ok) {
      setStatus(`Replace failed: ${result.error}`)
      return
    }
    setStatus(
      `Replaced ${result.replacements} in ${result.files} file${
        result.files === 1 ? '' : 's'
      }`
    )
    const refreshed = await window.api.searchProject(query, { caseSensitive })
    setResults(refreshed)
  }

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Find in Project</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="search-panel__controls">
        <input
          ref={inputRef}
          className="modal__input"
          placeholder="Search…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        <input
          className="modal__input"
          placeholder="Replace…"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
        <label className="search-panel__opt" title="Case sensitive">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={(e) => setCaseSensitive(e.target.checked)}
          />
          Aa
        </label>
        <button
          className="modal__primary"
          disabled={!query}
          onClick={() => void replaceAll()}
        >
          Replace All
        </button>
      </div>
      {status && <div className="search-panel__status">{status}</div>}
      <div className="search-panel__results">
        {results.map((file) => (
          <div key={file.path} className="search-file">
            <div className="search-file__name">{basename(file.path)}</div>
            {file.matches.map((match, i) => (
              <button
                key={`${match.line}:${match.column}:${i}`}
                className="search-match"
                onClick={() => onOpenMatch(file.path, match.line, match.column)}
              >
                <span className="search-match__line">{match.line}</span>
                <span className="search-match__preview">{match.preview.trim()}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
