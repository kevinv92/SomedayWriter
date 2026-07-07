/**
 * Types shared across the process boundary (main ↔ preload ↔ renderer). Defined
 * once here rather than copy-pasted, so the IPC contract has a single source of
 * truth. Renderer imports these type-only (erased at build); no runtime code
 * crosses the boundary through this module.
 */

/** Parsed `project.json`. Only the fields the app reads are typed; unknown keys
 * are ignored on read and (later) preserved on write. `project.name` is the one
 * required field. */
export type ProjectConfig = {
  project: { name: string; version?: string }
  editor?: {
    defaultExtension?: string
    wordWrap?: boolean
    diagnostics?: boolean
    /** Editor text-column width ("measure") in rem, or `'full'` to fill the
     * pane. Default 46. */
    measure?: number | 'full'
    /** Font: a preset (`serif` | `sans` | `mono`) or any CSS font-family string
     * (an installed font, e.g. `"iA Writer Duo, monospace"`). Default `serif`. */
    font?: 'serif' | 'sans' | 'mono' | (string & {})
    /** Font size in px. Default 16. */
    fontSize?: number
    /** Line height (unitless). Default 1.7. */
    lineHeight?: number
    /** Auto-save edits (debounced) instead of only on Cmd/Ctrl+S. Default false. */
    autosave?: boolean
  }
  explorer?: { ignore?: string[] }
  threads?: Record<string, { name?: string; color?: string }>
}

/** A resolved, opened project. */
export type ProjectMeta = {
  /** Absolute path to the project folder (the folder holding `project.json`). */
  root: string
  /** Convenience mirror of `config.project.name`. */
  name: string
  config: ProjectConfig
}

/** One node in the file-explorer tree. Directories carry `children`; files
 * don't. `path` is absolute and is also the document id (`EditorDoc.uri`). */
export type TreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: TreeNode[]
  /** Manuscript `order` from the file's frontmatter (M6). Files only; absent
   * when the file declares none. Drives tree sort — see SPEC → Manuscript order. */
  order?: number
}

/**
 * Result of the Open-Project flow. A discriminated union rather than a thrown
 * error, so failures cross IPC as data (see AGENTS.md → Async & errors).
 */
export type OpenProjectResult =
  | { ok: true; project: ProjectMeta }
  | { ok: false; reason: 'cancelled' }
  | { ok: false; reason: 'no-config'; root: string }
  | { ok: false; reason: 'invalid-config'; root: string; message: string }

export type FileReadResult = { ok: true; text: string } | { ok: false; error: string }

export type WriteResult = { ok: true } | { ok: false; error: string }

/** A project in the recent-projects list (app settings, M12). */
export type RecentProject = { path: string; name: string; openedAt: number }

/** App/user settings — global, stored in the OS user-data dir, separate from
 * per-project `project.json` (SPEC → App settings). */
export type AppSettings = {
  recentProjects: RecentProject[]
  /** Persisted explorer sidebar width in px. */
  sidebarWidth?: number
  /** Companion-pane pinned references, keyed by project root → file paths.
   * Personal workspace state (per SPEC → Reference companion pane), not shared
   * in `project.json`. */
  pins?: Record<string, string[]>
}

/** A story entity from `StoryIndex` (Phase 5) — a profile file (`type` in its
 * frontmatter) resolved to a canonical name + aliases. `id` is its path. */
export type Entity = {
  id: string
  type: string
  name: string
  aliases: string[]
  path: string
}

/** A reference to an entity: where a surface form appears in the manuscript. */
export type EntityRef = {
  path: string
  line: number
  column: number
  surface: string
  preview: string
}

/** Where a file's display title came from (SPEC → File titles). */
export type TitleSource = 'frontmatter' | 'heading' | 'filename'

/** What `StoryIndex` + the frontmatter parser see for one file — the read-only
 * model the Inspector pane mirrors (Phase 5, M8b). Reflects the file **on disk**
 * (the index is disk-based), so unsaved edits appear after a save. */
export type FileInspection = {
  path: string
  title: { value: string; source: TitleSource }
  /** Manuscript `order` from frontmatter, or null when none is declared. */
  order: number | null
  /** File-level thread memberships from frontmatter (inline ranges are M9). */
  threads: string[]
  /** Entities mentioned in the prose, with occurrence counts (self excluded). */
  mentions: { name: string; type: string; count: number }[]
  /** Manuscript word count — frontmatter/notes excluded, mentions unwrapped. */
  wordCount: number
  /** Malformed-frontmatter messages; empty when the file parses cleanly. This is
   * the pane's key debug value. */
  warnings: string[]
}

/** One reference in the Companion pane (Phase 5, M8d) — an entity profile or a
 * pinned note, resolved to what the pane shows: a title, a type badge (the
 * entity `type`, or `'note'`), a one-line summary for the collapsed row, and the
 * body for the expanded view. `count` is set only for auto-follow scene entries
 * (occurrences in the active file). */
export type CompanionEntry = {
  path: string
  title: string
  type: string
  summary: string
  body: string
  count?: number
}

/** Options for project-wide search (M5). */
export type SearchOptions = { caseSensitive?: boolean }

/** One match within a file: 1-based line/column plus the whole line as preview. */
export type SearchMatch = {
  line: number
  column: number
  preview: string
}

/** Matches within a single file, for the project-search results list. */
export type SearchFileResult = {
  path: string
  matches: SearchMatch[]
}

/** Outcome of a project-wide replace-all. */
export type ReplaceResult =
  { ok: true; files: number; replacements: number } | { ok: false; error: string }
