import { Icon } from './Icon'

const isMac = navigator.platform.startsWith('Mac')

interface SaveStatusProps {
  /** Whether a text file is open (the button hides when nothing is editable). */
  hasFile: boolean
  /** Is the active tab dirty? */
  dirty: boolean
  /** How many open tabs have unsaved edits (for the "Unsaved (N)" count). */
  unsavedCount: number
  /** Is opt-in autosave on? */
  autosave: boolean
  /** Save the active tab now. */
  onSave: () => void
}

/**
 * The menubar save control: at a glance it says whether the current file is
 * Saved / Unsaved / auto-saving, and clicking it saves when there's something
 * to save. It reads its whole state from props — no local state — so it always
 * matches the document model.
 */
export function SaveStatus({
  hasFile,
  dirty,
  unsavedCount,
  autosave,
  onSave
}: SaveStatusProps) {
  if (!hasFile) return null

  let state: 'unsaved' | 'saving' | 'autosave' | 'saved'
  let label: string
  let icon: 'save' | 'check'
  let title: string

  if (dirty && !autosave) {
    state = 'unsaved'
    label = unsavedCount > 1 ? `Unsaved (${unsavedCount})` : 'Unsaved'
    icon = 'save'
    title = `Unsaved changes — click or ${isMac ? '⌘S' : 'Ctrl+S'} to save`
  } else if (dirty && autosave) {
    state = 'saving'
    label = 'Saving…'
    icon = 'save'
    title = 'Autosave will save shortly — click to save now'
  } else if (autosave) {
    state = 'autosave'
    label = 'Autosave on'
    icon = 'check'
    title = 'Autosave is on — changes save automatically'
  } else {
    state = 'saved'
    label = 'Saved'
    icon = 'check'
    title = 'All changes saved'
  }

  // Only actionable when there are edits to write; otherwise it's a status chip.
  const actionable = dirty

  return (
    <button
      className="menubar__save"
      data-state={state}
      title={title}
      aria-label={title}
      disabled={!actionable}
      onClick={actionable ? onSave : undefined}
    >
      <Icon name={icon} size={14} />
      <span className="menubar__save-label">{label}</span>
    </button>
  )
}
