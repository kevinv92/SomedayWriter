import { useMemo } from 'react'
import { Icon } from './Icon'

export type CommentMark = {
  line: number
  column: number
  comment: string
  span: string
}

/** Extract CriticMarkup comments from `text` (M24) — point `{>>…<<}` comments and
 * span-anchored `{==…==}{>>…<<}`, each with its 1-based line/column for jump. */
export function parseComments(text: string): CommentMark[] {
  const re = /(?:\{==(.*?)==\})?\{>>(.*?)<<\}/g
  const out: CommentMark[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const idx = m.index
    const lineStart = text.lastIndexOf('\n', idx - 1) + 1
    const line = text.slice(0, idx).split('\n').length
    out.push({
      line,
      column: idx - lineStart + 1,
      comment: m[2].trim(),
      span: (m[1] ?? '').trim()
    })
  }
  return out
}

interface CommentsPanelProps {
  text: string
  onJump: (line: number, column: number) => void
  onClose: () => void
}

/** Comments panel (Phase 9, M24) — every editorial comment in the current file,
 * newest position first isn't meaningful so kept in document order; click to jump. */
export function CommentsPanel({ text, onJump, onClose }: CommentsPanelProps) {
  const marks = useMemo(() => parseComments(text), [text])

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Comments</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="search-panel__results">
        {marks.length === 0 ? (
          <div className="search-panel__status">
            No comments here. Select text and add one from the toolbar, or type{' '}
            <code>{'{>>…<<}'}</code>.
          </div>
        ) : (
          marks.map((mark, i) => (
            <button
              key={`${mark.line}:${mark.column}:${i}`}
              className="comment-item"
              onClick={() => onJump(mark.line, mark.column)}
            >
              <span className="comment-item__icon">
                <Icon name="comment" size={14} />
              </span>
              <span className="comment-item__body">
                <span className="comment-item__text">{mark.comment || '(empty)'}</span>
                {mark.span && <span className="comment-item__span">“{mark.span}”</span>}
              </span>
              <span className="comment-item__line">{mark.line}</span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
