import { useMemo, useState } from 'react'
import { fuzzyScore } from '../lib/fuzzy'

export interface QuickCommand {
  id: string
  title: string
  hint?: string
  run: () => void
}

export interface QuickFile {
  path: string
  name: string
}

interface QuickInputProps {
  files: QuickFile[]
  commands: QuickCommand[]
  /** Initial query — `''` for file (Quick Open) mode, `'>'` for command mode. */
  initialQuery?: string
  onClose: () => void
  onOpenFile: (path: string) => void
}

/**
 * One quick-input widget backs both surfaces (SPEC → Search, quick-open &
 * command palette): a leading `>` switches from fuzzy **file** search (Quick
 * Open, `Cmd/Ctrl+P`) to fuzzy **command** search (Command Palette,
 * `Cmd/Ctrl+Shift+P`).
 */
export function QuickInput({
  files,
  commands,
  initialQuery = '',
  onClose,
  onOpenFile
}: QuickInputProps) {
  const [query, setQuery] = useState(initialQuery)
  const [index, setIndex] = useState(0)

  const isCommand = query.startsWith('>')
  const term = (isCommand ? query.slice(1) : query).trim()

  const fileResults = useMemo(() => {
    if (isCommand) return []
    return files
      .map((f) => ({ item: f, score: fuzzyScore(term, f.name) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 50)
      .map((r) => r.item)
  }, [term, isCommand, files])

  const commandResults = useMemo(() => {
    if (!isCommand) return []
    return commands
      .map((c) => ({ item: c, score: fuzzyScore(term, c.title) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((r) => r.item)
  }, [term, isCommand, commands])

  const count = isCommand ? commandResults.length : fileResults.length

  const choose = (i: number) => {
    if (isCommand) {
      const cmd = commandResults[i]
      if (!cmd) return
      onClose()
      cmd.run()
    } else {
      const file = fileResults[i]
      if (!file) return
      onClose()
      onOpenFile(file.path)
    }
  }

  return (
    <div className="modal-overlay quick-overlay" onMouseDown={onClose}>
      <div className="quickinput" onMouseDown={(e) => e.stopPropagation()}>
        <input
          className="quickinput__input"
          autoFocus
          value={query}
          placeholder="Go to file…  (type > for commands)"
          onChange={(e) => {
            setQuery(e.target.value)
            setIndex(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              setIndex((i) => Math.min(i + 1, count - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setIndex((i) => Math.max(i - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              choose(index)
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <div className="quickinput__list">
          {count === 0 ? (
            <div className="quickinput__empty">No matches</div>
          ) : isCommand ? (
            commandResults.map((c, i) => (
              <button
                key={c.id}
                className={`quickinput__item${i === index ? ' quickinput__item--active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className="quickinput__label">{c.title}</span>
                {c.hint && <span className="quickinput__hint">{c.hint}</span>}
              </button>
            ))
          ) : (
            fileResults.map((f, i) => (
              <button
                key={f.path}
                className={`quickinput__item${i === index ? ' quickinput__item--active' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => choose(i)}
              >
                <span className="quickinput__label">{f.name}</span>
                <span className="quickinput__hint">{f.path}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
