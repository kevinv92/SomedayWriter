import { useEffect, useRef, useState } from 'react'

/** A small overlay for name entry — used by new file / new folder / rename. */
interface PromptModalProps {
  title: string
  label: string
  initialValue?: string
  submitLabel?: string
  onSubmit: (value: string) => void
  onCancel: () => void
}

export function PromptModal({
  title,
  label,
  initialValue = '',
  submitLabel = 'OK',
  onSubmit,
  onCancel
}: PromptModalProps) {
  const [value, setValue] = useState(initialValue)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = inputRef.current
    if (!input) return
    input.focus()
    // Preselect the name (minus extension) so a rename is quick to retype.
    const dot = input.value.lastIndexOf('.')
    input.setSelectionRange(0, dot > 0 ? dot : input.value.length)
  }, [])

  const submit = () => {
    const trimmed = value.trim()
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        <label className="modal__label">
          {label}
          <input
            ref={inputRef}
            className="modal__input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
              else if (e.key === 'Escape') onCancel()
            }}
          />
        </label>
        <div className="modal__actions">
          <button className="toggle" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal__primary" onClick={submit}>
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

interface UnsavedChangesModalProps {
  filename: string
  onSave: () => void
  onDiscard: () => void
  onCancel: () => void
}

/** Shown when leaving a file with unsaved edits — Save / Discard / Cancel.
 * Guards against the silent data loss called out in the writer review (M-safety). */
export function UnsavedChangesModal({
  filename,
  onSave,
  onDiscard,
  onCancel
}: UnsavedChangesModalProps) {
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal__title">Unsaved changes</h2>
        <p className="modal__message">
          “{filename}” has unsaved changes. Save them before switching?
        </p>
        <div className="modal__actions">
          <button className="toggle" onClick={onCancel}>
            Cancel
          </button>
          <button className="modal__danger" onClick={onDiscard}>
            Discard
          </button>
          <button className="modal__primary" onClick={onSave}>
            Save
          </button>
        </div>
      </div>
    </div>
  )
}

interface ConfirmModalProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'OK',
  danger = false,
  onConfirm,
  onCancel
}: ConfirmModalProps) {
  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="modal__title">{title}</h2>
        <p className="modal__message">{message}</p>
        <div className="modal__actions">
          <button className="toggle" onClick={onCancel}>
            Cancel
          </button>
          <button
            className={danger ? 'modal__danger' : 'modal__primary'}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
