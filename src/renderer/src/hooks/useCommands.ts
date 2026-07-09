import type { RefObject } from 'react'
import type { QuickCommand } from '../components/QuickInput'
import type { EditorHandle } from '../components/Editor'
import type { ResolvedEntityType } from '@shared/entity-types'
import type { DocumentsApi } from './useDocuments'
import type { PanelsApi } from './usePanels'
import type { SettingsApi } from './useSettings'

/** Everything the command registry needs to drive the app. */
export interface CommandContext {
  documents: DocumentsApi
  panels: PanelsApi
  settings: SettingsApi
  /** Registered entity types — one "New <Type>" command each (M20). */
  entityTypes: ResolvedEntityType[]
  /** Live handle onto the editor, for formatting + cursor-context commands. */
  editorHandle: RefObject<EditorHandle | null>
  newProject: () => void
  openProject: () => void
  /** Compile the manuscript and save it to a single Markdown file. */
  exportManuscript: () => void
  /** Compile the manuscript to an EPUB and save it. */
  exportEpub: () => void
  forceRefresh: () => void
  goToDefinition: (lineText: string, column: number) => void
  togglePin: (path: string) => void
  insertImageFromPicker: () => void
  /** Open the New-File modal at the project root (optionally seeding a type). */
  onNewFile: (entityType?: string) => void
  /** Open the New-Folder modal at the project root. */
  onNewFolder: () => void
  /** Open the Project Settings form. */
  onProjectSettings: () => void
}

/**
 * The command registry (SPEC → command palette). The palette, menus, and
 * keybindings all draw from this one list. Built fresh each render so titles
 * reflect live state (e.g. "Toggle Vim (on)") and `run` closures capture current
 * values — extracted from App so the ~40-entry table lives on its own.
 */
export function useCommands(ctx: CommandContext): QuickCommand[] {
  const { documents, panels, settings, editorHandle } = ctx
  return [
    { id: 'nav-back', title: 'Go Back', hint: '⌘[', run: () => documents.goBack() },
    {
      id: 'nav-forward',
      title: 'Go Forward',
      hint: '⌘]',
      run: () => documents.goForward()
    },
    { id: 'new-project', title: 'New Project…', run: () => ctx.newProject() },
    { id: 'open-project', title: 'Open Project…', run: () => ctx.openProject() },
    {
      id: 'export-manuscript',
      title: 'Export Manuscript (Markdown)…',
      run: () => ctx.exportManuscript()
    },
    {
      id: 'export-epub',
      title: 'Export to EPUB…',
      run: () => ctx.exportEpub()
    },
    {
      id: 'format-bold',
      title: 'Bold',
      hint: '⌘B',
      run: () => editorHandle.current?.format('bold')
    },
    {
      id: 'format-italic',
      title: 'Italic',
      hint: '⌘I',
      run: () => editorHandle.current?.format('italic')
    },
    {
      id: 'format-link',
      title: 'Insert Link',
      hint: '⌘K',
      run: () => editorHandle.current?.format('link')
    },
    {
      id: 'new-file',
      title: 'New File',
      run: () => ctx.onNewFile()
    },
    // One "New <Type>" per registered entity type (M20) — opens the New-File
    // modal with that type preselected, seeding its frontmatter skeleton.
    ...ctx.entityTypes.map((t) => ({
      id: `new-${t.type}`,
      title: `New ${t.label}`,
      run: () => ctx.onNewFile(t.type)
    })),
    {
      id: 'new-folder',
      title: 'New Folder',
      run: () => ctx.onNewFolder()
    },
    {
      id: 'find-in-project',
      title: 'Find in Project',
      hint: '⌘⇧F',
      run: () => panels.toggle('search')
    },
    {
      id: 'find-references',
      title: 'Find References…',
      run: () => panels.set('refs', true)
    },
    {
      id: 'go-to-definition',
      title: 'Go to Definition',
      run: () => {
        const cursor = editorHandle.current?.cursorContext()
        if (cursor) ctx.goToDefinition(cursor.lineText, cursor.column)
      }
    },
    {
      id: 'toggle-inspector',
      title: 'Toggle Inspector',
      run: () => panels.toggle('inspector')
    },
    {
      id: 'toggle-companion',
      title: 'Toggle Companion',
      run: () => panels.toggle('companion')
    },
    {
      id: 'toggle-threads',
      title: 'Toggle Threads',
      run: () => panels.toggle('threads')
    },
    {
      id: 'toggle-braid',
      title: 'Toggle Thread Braid',
      run: () => panels.toggle('braid')
    },
    {
      id: 'reload-from-disk',
      title: 'Reload from Disk',
      run: () => ctx.forceRefresh()
    },
    {
      id: 'project-settings',
      title: 'Project Settings…',
      run: () => ctx.onProjectSettings()
    },
    {
      id: 'pin-to-companion',
      title: 'Pin Current File to Companion',
      run: () => {
        if (documents.activePath) {
          ctx.togglePin(documents.activePath)
          panels.set('companion', true)
        }
      }
    },
    {
      id: 'toggle-vim',
      title: `Toggle Vim (${settings.vim ? 'on' : 'off'})`,
      run: () => settings.toggleVim()
    },
    {
      id: 'toggle-diagnostics',
      title: `Toggle Diagnostics (${settings.diagnostics ? 'on' : 'off'})`,
      run: () => settings.toggleDiagnostics()
    },
    {
      id: 'toggle-autosave',
      title: `Toggle Autosave (${settings.autosave ? 'on' : 'off'})`,
      run: () => settings.toggleAutosave()
    },
    {
      id: 'theme-light',
      title: 'Theme: Warm Paper (Light)',
      run: () => settings.changeTheme('light')
    },
    {
      id: 'theme-dark',
      title: 'Theme: Warm Dusk (Dark)',
      run: () => settings.changeTheme('dark')
    },
    {
      id: 'theme-auto',
      title: 'Theme: Match System',
      run: () => settings.changeTheme('auto')
    },
    {
      id: 'cycle-accent',
      title: `Cycle Accent (${settings.accent})`,
      run: () => settings.cycleAccent()
    },
    {
      id: 'toggle-focus',
      title: `Toggle Focus Mode (${settings.focusMode ? 'on' : 'off'})`,
      run: () => settings.toggleFocus()
    },
    {
      id: 'add-comment',
      title: 'Add Comment',
      run: () => editorHandle.current?.format('comment')
    },
    {
      id: 'suggest-delete',
      title: 'Suggest Deletion (track change)',
      run: () => editorHandle.current?.format('suggest-delete')
    },
    {
      id: 'suggest-insert',
      title: 'Suggest Insertion (track change)',
      run: () => editorHandle.current?.format('suggest-insert')
    },
    {
      id: 'accept-change',
      title: 'Accept Change at Cursor',
      run: () => editorHandle.current?.resolveChange(true)
    },
    {
      id: 'reject-change',
      title: 'Reject Change at Cursor',
      run: () => editorHandle.current?.resolveChange(false)
    },
    {
      id: 'format-table',
      title: 'Format Table (align columns)',
      run: () => editorHandle.current?.formatTable()
    },
    {
      id: 'insert-image',
      title: 'Insert Image…',
      run: () => ctx.insertImageFromPicker()
    },
    {
      id: 'help',
      title: 'Help',
      run: () => panels.set('help', true)
    },
    {
      id: 'save',
      title: 'Save',
      hint: '⌘S',
      run: () => {
        if (documents.activePath) void documents.saveTab(documents.activePath)
      }
    },
    {
      id: 'close-tab',
      title: 'Close Tab',
      hint: '⌘W',
      run: () => {
        if (documents.activePath) documents.closeTab(documents.activePath)
      }
    }
  ]
}
