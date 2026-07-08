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
  /** Directory relative to the project root ('' at the root) — shown as a dimmed
   * location hint next to the file name. */
  rel?: string
}

interface QuickInputProps {
  files: QuickFile[]
  commands: QuickCommand[]
  /** Recently opened file paths (most-recent first) — ordered atop an empty query. */
  recentFiles?: string[]
  /** Recently run command ids (most-recent first) — ordered atop an empty query. */
  recentCommands?: string[]
  /** Fires with a command's id when it's run, so the caller can track recency. */
  onRunCommand?: (id: string) => void
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
  recentFiles,
  recentCommands,
  onRunCommand,
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
    // Empty query → most-recently-opened first, then the rest in tree order.
    if (!term) {
      const order = new Map((recentFiles ?? []).map((p, i) => [p, i]))
      return [...files]
        .sort((a, b) => {
          const ai = order.get(a.path) ?? Infinity
          const bi = order.get(b.path) ?? Infinity
          return ai === bi ? 0 : ai - bi
        })
        .slice(0, 50)
    }
    return files
      .map((f) => {
        // Match on the file name and on its project-relative path, so you can
        // search by folder ("manuscript"), extension, or "manuscript/betrayal".
        const relPath = f.rel ? `${f.rel}/${f.name}` : f.name
        const nameScore = fuzzyScore(term, f.name)
        const pathScore = fuzzyScore(term, relPath)
        const score =
          nameScore === null && pathScore === null
            ? null
            : // Favour a name hit, but let a path-only hit through.
              Math.max(nameScore ?? -Infinity, (pathScore ?? -Infinity) - 1)
        return { item: f, score }
      })
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 50)
      .map((r) => r.item)
  }, [term, isCommand, files, recentFiles])

  const commandResults = useMemo(() => {
    if (!isCommand) return []
    // Empty command query → recently-run commands first, then the rest.
    if (!term) {
      const order = new Map((recentCommands ?? []).map((id, i) => [id, i]))
      return [...commands].sort((a, b) => {
        const ai = order.get(a.id) ?? Infinity
        const bi = order.get(b.id) ?? Infinity
        return ai === bi ? 0 : ai - bi
      })
    }
    return commands
      .map((c) => ({ item: c, score: fuzzyScore(term, c.title) }))
      .filter((r) => r.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .map((r) => r.item)
  }, [term, isCommand, commands, recentCommands])

  const count = isCommand ? commandResults.length : fileResults.length

  const choose = (i: number) => {
    if (isCommand) {
      const cmd = commandResults[i]
      if (!cmd) return
      onClose()
      onRunCommand?.(cmd.id)
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
                {f.rel && <span className="quickinput__hint">{f.rel}</span>}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
