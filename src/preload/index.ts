import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  CompanionEntry,
  Entity,
  EntityRef,
  FileInspection,
  FileReadResult,
  GrammarMatch,
  Thread,
  OpenProjectResult,
  ReplaceResult,
  SearchFileResult,
  SearchOptions,
  TreeNode,
  WriteResult
} from '../shared/types'

/**
 * The complete surface the renderer is allowed to reach. Every capability the
 * UI gets must be added here explicitly — the renderer never touches `fs` or
 * Node directly, and never sees a raw channel string.
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping'),

  /** Prompt for a folder and open it as a project (reads `project.json`). */
  openProject: (): Promise<OpenProjectResult> => ipcRenderer.invoke('project:open'),
  newProject: (): Promise<OpenProjectResult> => ipcRenderer.invoke('project:new'),

  /** Open a known project folder by path (recent projects). */
  openRecent: (path: string): Promise<OpenProjectResult> =>
    ipcRenderer.invoke('project:openPath', path),

  /** Global app settings (recent projects, sidebar width, …). */
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),

  /** Merge a patch into global app settings. */
  updateSettings: (patch: Partial<AppSettings>): Promise<AppSettings> =>
    ipcRenderer.invoke('settings:update', patch),

  /** Explorer tree for the open project, or null if none is open. */
  readTree: (): Promise<TreeNode | null> => ipcRenderer.invoke('project:readTree'),

  /** Read a file inside the open project. */
  readFile: (path: string): Promise<FileReadResult> =>
    ipcRenderer.invoke('file:read', path),

  /** Write a file inside the open project. */
  writeFile: (path: string, contents: string): Promise<WriteResult> =>
    ipcRenderer.invoke('file:write', path, contents),

  /** Create an empty file (fails if it already exists). */
  createFile: (path: string): Promise<WriteResult> =>
    ipcRenderer.invoke('file:create', path),

  /** Create a directory (fails if it already exists). */
  createFolder: (path: string): Promise<WriteResult> =>
    ipcRenderer.invoke('folder:create', path),

  /** Rename/move a file or folder within the project. */
  rename: (from: string, to: string): Promise<WriteResult> =>
    ipcRenderer.invoke('path:rename', from, to),

  /** Delete a file or folder (recursive) within the project. */
  remove: (path: string): Promise<WriteResult> => ipcRenderer.invoke('path:remove', path),

  /** Set a file's manuscript `order` (frontmatter), preserving the rest (M6). */
  setOrder: (path: string, value: number): Promise<WriteResult> =>
    ipcRenderer.invoke('file:setOrder', path, value),

  /** Search text across all `.md` files in the project (M5). */
  searchProject: (query: string, opts: SearchOptions): Promise<SearchFileResult[]> =>
    ipcRenderer.invoke('project:search', query, opts),

  /** Replace all occurrences of `query` with `replacement` across the project. */
  replaceInProject: (
    query: string,
    replacement: string,
    opts: SearchOptions
  ): Promise<ReplaceResult> =>
    ipcRenderer.invoke('project:replace', query, replacement, opts),

  /** Story entities (characters, …) from the project's profile files (Phase 5). */
  storyEntities: (): Promise<Entity[]> => ipcRenderer.invoke('story:entities'),

  /** Every reference to an entity across the manuscript (find-references). */
  storyReferences: (entity: Entity): Promise<EntityRef[]> =>
    ipcRenderer.invoke('story:references', entity),

  /** The parsed model for one file on disk — powers the Inspector pane (M8b). */
  inspectFile: (path: string): Promise<FileInspection | null> =>
    ipcRenderer.invoke('story:inspect', path),

  /** Entities detected in a file — the Companion's auto-follow set (M8d). */
  sceneRefs: (path: string): Promise<CompanionEntry[]> =>
    ipcRenderer.invoke('story:sceneRefs', path),

  /** Load one reference (entity or pinned note) for the Companion pane (M8d). */
  loadRef: (path: string): Promise<CompanionEntry | null> =>
    ipcRenderer.invoke('story:loadRef', path),

  /** The project-wide thread model — membership + per-thread order (M9). */
  storyThreads: (): Promise<Thread[]> => ipcRenderer.invoke('story:threads'),
  storyHealth: (): Promise<EntityRef[]> => ipcRenderer.invoke('story:health'),
  countMentions: (surface: string): Promise<{ count: number; files: number }> =>
    ipcRenderer.invoke('story:countMentions', surface),
  renameMentions: (
    from: string,
    to: string,
    skip: string[]
  ): Promise<{ changed: string[]; skipped: string[]; count: number }> =>
    ipcRenderer.invoke('story:renameMentions', from, to, skip),

  /** Drop the cached story index so external file changes are re-read. */
  refreshIndex: (): Promise<void> => ipcRenderer.invoke('story:refresh'),

  /** Pick an image via a dialog; copies it into the project's assets/ folder and
   * returns its project-relative path (or null if cancelled). */
  pickImage: (): Promise<{ path: string } | null> => ipcRenderer.invoke('image:pick'),

  /** Import a known image file (e.g. dragged in) into assets/; returns its path. */
  importImageFile: (sourcePath: string): Promise<{ path: string } | null> =>
    ipcRenderer.invoke('image:importFile', sourcePath),

  /** Grammar/style check (Phase 10) — routed to LanguageTool in main. Returns
   * offset-based hits; `[]` when the checker is off/unconfigured. */
  checkGrammar: (text: string): Promise<GrammarMatch[]> =>
    ipcRenderer.invoke('analysis:grammar', text),

  /** Sync a document to the language server (M27). No-op unless the LSP engine
   * is configured; diagnostics come back via `onGrammarDiagnostics`. */
  lspSync: (path: string, text: string): Promise<void> =>
    ipcRenderer.invoke('lsp:sync', path, text),
  /** Tell the language server a document closed (M27). */
  lspClose: (path: string): Promise<void> => ipcRenderer.invoke('lsp:close', path),
  /** Subscribe to pushed grammar diagnostics from the language server (M27).
   * Returns an unsubscribe. */
  onGrammarDiagnostics: (
    cb: (uri: string, matches: GrammarMatch[]) => void
  ): (() => void) => {
    const listener = (_e: unknown, uri: string, matches: GrammarMatch[]): void =>
      cb(uri, matches)
    ipcRenderer.on('lsp:diagnostics', listener)
    return () => ipcRenderer.removeListener('lsp:diagnostics', listener)
  }
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
