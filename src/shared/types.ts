/**
 * Types shared across the process boundary (main ↔ preload ↔ renderer). Defined
 * once here rather than copy-pasted, so the IPC contract has a single source of
 * truth. Renderer imports these type-only (erased at build); no runtime code
 * crosses the boundary through this module.
 */

/** Parsed `project.json`. Only the fields the app reads are typed; unknown keys
 * are ignored on read and (later) preserved on write. `project.name` is the one
 * required field. */
/** A theme = a set of design-token overrides applied on `<html>` (Phase 8). Ships
 * both from app-settings (`userThemes`) and per-project (`project.json` `themes`).
 * `base` picks which built-in theme fills in any tokens the theme doesn't set. */
export type ThemeDef = {
  /** Stable id used to select the theme (`data`/settings value). */
  id: string
  /** Human label shown in the picker. */
  name: string
  /** Built-in theme to inherit unset tokens from. Default 'dark'. */
  base?: 'light' | 'dark'
  /** Token overrides — keys are token names (`bg`, `--bg`, `accent`, `font-mono`,
   * …); values are any CSS value. Applied as custom properties on `<html>`. */
  tokens: Record<string, string>
}

export type ProjectConfig = {
  project: { name: string; version?: string }
  /** Default theme id for this project (built-in `auto`/`light`/`dark`, a user
   * theme, or one of this project's own `themes`). Phase 8. */
  theme?: string
  /** Themes this project ships (appear in the picker while it's open). */
  themes?: ThemeDef[]
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
  /** Registered entity types (Phase 7, M18) — display metadata + the fields each
   * type declares. This is type *schema* (tool config), so unlike thread identity
   * it lives in `project.json`, not in content (decision #45). Merged over the
   * built-in defaults, so a project only lists what it overrides or adds; see
   * `resolveEntityTypes`. */
  entityTypes?: EntityTypeDef[]
}

/** One field a `type: …` profile declares (Phase 7, M18). Drives frontmatter
 * intellisense (M19) and new-file templates (M20). */
export type EntityFieldDef = {
  /** Frontmatter key, e.g. `region`. */
  name: string
  /** Display label; defaults to a title-cased `name`. */
  label?: string
  /** Allowed values — makes the field enum-ish, so M19 offers exactly these. */
  values?: string[]
  /** A list field (YAML sequence), e.g. `aliases`, `threads`. */
  repeated?: boolean
}

/** A registered entity type (Phase 7, M18): how the tree/inspector/visualiser
 * badge it, plus the fields it declares. `type` matches the frontmatter
 * discriminator. All display fields are optional — `resolveEntityTypes` fills
 * sensible defaults so unknown/partial types still work. */
export type EntityTypeDef = {
  type: string
  /** Display name, e.g. "Location". Defaults to a title-cased `type`. */
  label?: string
  /** Short glyph (emoji) shown in the tree + type badges. Legacy fallback; the
   * app now prefers `iconName` (a Writer icon-set SVG). */
  icon?: string
  /** Name of a Writer icon-set icon (see `Icon.tsx`) for the badge — themes with
   * `currentColor`. Falls back to `icon` (emoji) for custom types that omit it. */
  iconName?: string
  /** Badge accent colour (kept light until the Phase 8 design system). */
  color?: string
  /** The fields this type declares, in template/intellisense order. */
  fields?: EntityFieldDef[]
}

/** A resolved, opened project. */
export type ProjectMeta = {
  /** Absolute path to the project folder (the folder holding `project.json`). */
  root: string
  /** Convenience mirror of `config.project.name`. */
  name: string
  config: ProjectConfig
}

/** Result of writing an edited `project.json` back (the Project Settings form). */
export type WriteConfigResult =
  { ok: true; project: ProjectMeta } | { ok: false; error: string }

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

export type FileReadResult =
  { ok: true; text: string; mtimeMs: number } | { ok: false; error: string }

export type WriteResult = { ok: true } | { ok: false; error: string }

/** The outcome of writing an editor buffer (file:write). Like WriteResult, but
 * success carries the new mtime so the tab can re-baseline, and there's a
 * `conflict` variant: the file changed on disk since the tab last read it — the
 * guard against silently clobbering an external edit (e.g. an agent CLI editing
 * the same folder). `diskMtimeMs` is the on-disk timestamp we refused to
 * overwrite. */
export type WriteFileResult =
  | { ok: true; mtimeMs: number }
  | { ok: false; conflict: true; diskMtimeMs: number }
  | { ok: false; error: string }

/** A project in the recent-projects list (app settings, M12). */
export type RecentProject = { path: string; name: string; openedAt: number }

/** App/user settings — global, stored in the OS user-data dir, separate from
 * per-project `project.json` (SPEC → App settings). */
export type AppSettings = {
  recentProjects: RecentProject[]
  /** Persisted explorer sidebar width in px. */
  sidebarWidth?: number
  /** Persisted width (px) of the right-side panels (search / references /
   * inspector / companion), which share one width. */
  panelWidth?: number
  /** Companion-pane pinned references, keyed by project root → file paths.
   * Personal workspace state (per SPEC → Reference companion pane), not shared
   * in `project.json`. */
  pins?: Record<string, string[]>
  /** Explorer-pinned files (quick access), keyed by project root → file paths.
   * Shown in a "Pinned" section atop the file tree. Personal, per-project. */
  explorerPins?: Record<string, string[]>
  /** Visual theme id (Phase 8). Built-ins: 'auto' (follows OS), 'light' (warm
   * paper), 'dark' (warm dusk). May also be a custom theme's id from
   * `userThemes` or a project's `themes`. Applied as `data-theme` (+ token
   * overrides) on `<html>`. Default 'auto'. */
  theme?: string
  /** Accent hue (Phase 8) — one of the design system's accent options
   * (ink · sage · clay · plum · gold · slate). Applied as `data-accent`.
   * Default 'ink'. */
  accent?: string
  /** User-defined themes (Phase 8) — hand-authored token maps that appear in the
   * theme picker. Edit `settings.json` to add your own. */
  userThemes?: ThemeDef[]
  /** Focus mode (Phase 8 M22) — dims chrome to a calm reading column.
   * Applied as `data-focus` on `<html>`. Default false. */
  focusMode?: boolean
  /** Vim keybindings on/off — a personal editing preference, persisted globally
   * so it (and the line-number gutter) survives across sessions. Default false. */
  vim?: boolean
  /** Vim `j`/`k` move by display line (gj/gk) instead of logical line — better
   * for wrapped prose. Persisted globally. Default true. */
  vimWrapMotion?: boolean
  /** External grammar/style checking (Phase 10). Hand-edited in `settings.json`;
   * the secrets (`apiKey`/`username`) are stripped before this object is handed
   * to the renderer — the key lives only in main. */
  grammar?: GrammarSettings
}

/** Configuration for the external grammar/style provider (Phase 10, M26). Points
 * at a LanguageTool server — a **self-hosted** instance keeps prose on-device
 * (recommended); the public cloud API works too. Opt-in: off unless `enabled`. */
export type GrammarSettings = {
  /** Turn the provider on. Default false — nothing is sent anywhere until set. */
  enabled?: boolean
  /** LanguageTool base URL, e.g. `http://localhost:8081` (self-hosted) or
   * `https://api.languagetool.org`. The `/v2/check` path is appended. */
  url?: string
  /** Language code (`en-US`, `de-DE`, …) or `auto` to detect. Default `auto`. */
  language?: string
  /** Native language (`motherTongue`) — improves false-friend detection. */
  motherTongue?: string
  /** Premium cloud credentials. Live only in main; never sent to the renderer. */
  apiKey?: string
  username?: string
  /** Attach a real language server over LSP (Phase 10, M27) instead of the HTTP
   * checker — e.g. `ltex-ls` for LanguageTool. `command` is the server argv
   * (`["ltex-ls"]` or `["java","-jar","…/ltex-ls.jar"]`). When set (and
   * `enabled`), the LSP engine supersedes the HTTP `url`. Diagnostics arrive as
   * push notifications, so this is a live connection, not a per-edit request. */
  lsp?: {
    command: string[]
    /** Overrides the top-level `language` for the server's config. */
    language?: string
    /** Workspace root the server sees; defaults to the file's directory. */
    rootUri?: string
  }
}

/** One grammar/style hit from the external checker (Phase 10), in the offset form
 * the editor uses. Crosses IPC as this shape; the renderer provider maps it to a
 * `Diagnostic` (offset → from, offset+length → to). */
export type GrammarMatch = {
  /** Character offset of the flagged span. */
  offset: number
  /** Length of the flagged span. */
  length: number
  message: string
  /** LanguageTool `rule.issueType` folded to the editor's severities. */
  severity: 'error' | 'warning' | 'info'
  /** Rule id + category, for future filtering/quick-fix. */
  ruleId?: string
  category?: string
  /** Suggested replacements (first few), for a future quick-fix. */
  replacements?: string[]
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

/** One scene on a thread (Phase 5, M9). `threadOrder` is the explicit per-thread
 * beat position when the scene declares one; otherwise it's null and the beat
 * falls back to `manuscriptOrder` (then title) for sequencing. */
/** How intense a beat is on its thread — drives the lane's shape (Threads v2). */
export type ThreadIntensity = 'setup' | 'rise' | 'climax' | 'fall' | 'resolve'

/** A beat's lifecycle role on its thread: `opens` starts/branches it, `closes`
 * ends/merges it, `touches` (default) is a normal mid-thread beat (Threads v2). */
export type ThreadState = 'opens' | 'closes' | 'touches'

export type ThreadBeat = {
  path: string
  title: string
  manuscriptOrder: number | null
  /** Position within this thread — from the `pos` key (renamed from `order`). */
  threadOrder: number | null
  /** One-line note of what the thread does in this scene (Threads v2). */
  summary: string | null
  intensity: ThreadIntensity | null
  state: ThreadState
}

/** A story thread (Phase 5, M9): a storyline running across scenes. Membership +
 * per-thread order come from each scene's `threads:` frontmatter; identity
 * (display name, colour, description) comes from an optional `type: thread`
 * entity file (decision #45) — `path`/`color`/`description` are null/empty when no
 * such file exists. `beats` are ordered in thread order. */
export type Thread = {
  /** Display name — the entity's name when resolved, else the raw tag. */
  name: string
  /** The raw tag used in scene frontmatter (the grouping key). */
  tag: string
  color: string | null
  description: string
  /** The `type: thread` entity file, if one exists. */
  path: string | null
  beats: ThreadBeat[]
}

/** A thread the pacing lint flags as neglected (Threads v2, #2): it never
 *  `closes` yet has gone quiet for a while before the manuscript ends. */
export type NeglectedThread = {
  name: string
  tag: string
  /** Scenes since the thread's last beat (up to the manuscript end). */
  scenes: number
  /** Words in those trailing scenes (approximate). */
  words: number
  /** The last beat's summary (or scene title) — for "…since '<x>'". */
  since: string
  /** The last beat's scene path — the jump target. */
  path: string
  /** Opened but never closed (a dangling arc), vs. just gone quiet. */
  dangling: boolean
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

/** One scene in a compiled manuscript (for the export summary). */
export interface ExportScene {
  title: string
  order: number
  path: string
}

/** Result of compiling the manuscript (export:manuscript). */
export type ExportManuscriptResult =
  | { ok: true; text: string; scenes: ExportScene[]; wordCount: number }
  | { ok: false; error: string }

/** Result of writing an exported manuscript to disk via the save dialog. */
export type ExportSaveResult =
  { ok: true; path: string } | { ok: false; canceled?: boolean; error?: string }

/** Result of compiling + saving the manuscript as an EPUB. */
export type ExportEpubResult =
  | { ok: true; path: string; chapters: number }
  | { ok: false; canceled?: boolean; error?: string }
