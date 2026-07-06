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
