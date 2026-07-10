import { existsSync, promises as fs } from 'fs'
import { basename, dirname, extname, join, resolve, sep } from 'path'
import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import type {
  AppSettings,
  CompanionEntry,
  Entity,
  EntityRef,
  ExportManuscriptResult,
  ExportSaveResult,
  ExportEpubResult,
  FileInspection,
  FileReadResult,
  GrammarMatch,
  Thread,
  OpenProjectResult,
  ProjectConfig,
  ProjectMeta,
  ReplaceResult,
  SearchFileResult,
  SearchOptions,
  TreeNode,
  WriteConfigResult,
  WriteFileResult,
  WriteResult
} from '../shared/types'
import {
  buildEntities,
  buildThreads,
  countMentions,
  deadReferences,
  inspectFile,
  loadCompanionEntry,
  referencesTo,
  renameMentions,
  sceneEntities
} from './story-index'
import { addRecentProject, readSettings, updateSettings } from './settings'
import { checkGrammar } from './grammar'
import { lspSync, lspClose, shutdownLsp, setLspDiagnosticsSink } from './lsp'
import {
  DEFAULT_IGNORE,
  defaultProjectConfig,
  isInside,
  listMarkdownFiles,
  readProjectConfig,
  readTree,
  writeProjectConfig
} from './fs-project'
import { writeOrder } from './frontmatter'
import { writeDefaultAgentsDoc } from './agents-doc'
import { findMatches, replaceAll } from './search'
import { randomUUID } from 'crypto'
import { gatherManuscript } from './export'
import { buildEpub } from './epub'
import {
  compileManuscript,
  countManuscriptWords,
  stripEditorial,
  stripFrontmatter
} from '../shared/manuscript'

// The project the renderer is currently allowed to touch. Every file op is
// validated against this root, so a renderer can't reach outside it.
let currentProject: ProjectMeta | null = null

// The single app window, kept so main can push (e.g. LSP diagnostics) to it.
let mainWindow: BrowserWindow | null = null

// A privileged scheme so the sandboxed renderer can display project images
// without file:// access. `writer-asset://asset/<project-relative path>` serves
// files from the open project only (path-traversal guarded). Must be registered
// before the app is ready.
const ASSET_SCHEME = 'writer-asset'
protocol.registerSchemesAsPrivileged([
  {
    scheme: ASSET_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp'
}
const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp']

function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    if (!currentProject) return new Response('No project', { status: 404 })
    try {
      const rel = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
      const abs = resolve(currentProject.root, rel)
      if (abs !== currentProject.root && !abs.startsWith(currentProject.root + sep)) {
        return new Response('Forbidden', { status: 403 })
      }
      const data = await fs.readFile(abs)
      return new Response(new Uint8Array(data), {
        headers: {
          'content-type':
            IMAGE_MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
        }
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/** Copy an image into the project's `assets/` folder (deduping the name) and
 * return its project-relative POSIX path. */
async function importImage(source: string): Promise<string> {
  const root = currentProject!.root
  const assetsDir = join(root, 'assets')
  await fs.mkdir(assetsDir, { recursive: true })
  const base = basename(source)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  let name = base
  let i = 1
  for (;;) {
    try {
      await fs.access(join(assetsDir, name))
      name = `${stem}-${i}${ext}`
      i++
    } catch {
      break
    }
  }
  await fs.copyFile(source, join(assetsDir, name))
  return `assets/${name}`
}

// Cached story index: `buildEntities`/`buildThreads` each scan the whole project,
// and several IPC handlers need them per panel refresh. Cache both and invalidate
// on any write (or a manual "Reload from Disk"), so a refresh with several panels
// open doesn't re-scan the project multiple times.
let entityCache: Entity[] | null = null
let threadCache: Thread[] | null = null

async function getEntities(): Promise<Entity[]> {
  if (!currentProject) return []
  if (!entityCache) {
    const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
    entityCache = await buildEntities(currentProject.root, ignore)
  }
  return entityCache
}

async function getThreads(): Promise<Thread[]> {
  if (!currentProject) return []
  if (!threadCache) {
    const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
    threadCache = await buildThreads(currentProject.root, ignore, await getEntities())
  }
  return threadCache
}

/** Drop the cached index — call on any write or when files may have changed on
 * disk (project open, external edits via the manual reload). */
function invalidateStoryIndex(): void {
  entityCache = null
  threadCache = null
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    show: false,
    title: 'SomedayWriter',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security: renderer is sandboxed and isolated; no direct Node/fs access.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  mainWindow = win
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  win.on('ready-to-show', () => win.show())

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // The renderer is a single-page app — it must **never** navigate the window
  // away from itself. Without this, dropping a drag onto the window (e.g. after
  // panning the Threads braid) makes the browser navigate to the dragged
  // content and **blanks the whole app**. Block any navigation off the current
  // page; send real external URLs to the OS browser instead. Same-origin
  // navigations (e.g. a dev full-reload) are allowed through.
  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL()
    if (url === current) return // a plain reload of the same page
    // In dev the app is served over http://localhost — allow same-origin
    // navigations (Vite HMR / full reload). Everything else (a file:// drop, an
    // external link) is blocked so it can't replace and blank the app; real
    // http(s) URLs open in the OS browser.
    try {
      const u = new URL(url)
      const c = new URL(current)
      if (u.protocol.startsWith('http') && u.origin === c.origin) return
    } catch {
      /* unparseable → block below */
    }
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  // electron-vite sets this in dev; in prod we load the built file.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The repo root — the nearest ancestor that actually holds `src/mcp/server.ts`,
 * so the Help's MCP config points at the right place in dev or a built run.
 * Falls back to the process cwd. */
function repoRoot(): string {
  let dir = __dirname
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, 'src', 'mcp', 'server.ts'))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return process.cwd()
}

function isNotFound(err: unknown): boolean {
  return (err as NodeJS.ErrnoException)?.code === 'ENOENT'
}

function setCurrentProject(root: string, config: ProjectMeta['config']): ProjectMeta {
  currentProject = { root, name: config.project.name, config }
  invalidateStoryIndex() // a different project → rebuild the index on next fetch
  return currentProject
}

/** A folder was picked but has no `project.json` — offer to initialize it.
 * Runs the confirm + write in main so no renderer-supplied path is trusted. */
async function offerCreateProject(
  root: string,
  win: BrowserWindow | null
): Promise<OpenProjectResult> {
  const box = {
    type: 'question' as const,
    buttons: ['Create Project', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Create a new SomedayWriter project here?',
    detail: `${root}\n\nThis folder has no project.json. Create one to start writing.`
  }
  const { response } = win
    ? await dialog.showMessageBox(win, box)
    : await dialog.showMessageBox(box)
  if (response !== 0) return { ok: false, reason: 'cancelled' }
  return initProject(root)
}

/** Write a default `project.json` into `root` and open it. */
async function initProject(root: string): Promise<OpenProjectResult> {
  try {
    const config = defaultProjectConfig(basename(root))
    await writeProjectConfig(root, config)
    // Drop in a templated AGENTS.md so any agent CLI pointed at this folder
    // understands its story conventions. Best-effort; never clobbers an author's.
    await writeDefaultAgentsDoc(root, config.project.name)
    const project = setCurrentProject(root, config)
    await addRecentProject(root, project.name, Date.now())
    return { ok: true, project }
  } catch (err) {
    return { ok: false, reason: 'invalid-config', root, message: messageOf(err) }
  }
}

/** Explicit "New Project": pick/create a folder, then initialise a project there
 * (or just open it if it's already one). No extra confirm — the user chose new. */
async function createProject(): Promise<OpenProjectResult> {
  const win = BrowserWindow.getFocusedWindow()
  const opts: OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
    buttonLabel: 'Create Project'
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, reason: 'cancelled' }
  }
  const root = result.filePaths[0]
  const existing = await openProjectPath(root)
  if (existing.ok || existing.reason === 'invalid-config') return existing
  return initProject(root)
}

/** Open a known folder path as a project (no dialog). Used by "open recent" and
 * by `openProject` after the folder is picked. Records it in recent projects. */
async function openProjectPath(root: string): Promise<OpenProjectResult> {
  try {
    const config = await readProjectConfig(root)
    const project = setCurrentProject(root, config)
    await addRecentProject(root, project.name, Date.now())
    return { ok: true, project }
  } catch (err) {
    if (isNotFound(err)) return { ok: false, reason: 'no-config', root }
    return { ok: false, reason: 'invalid-config', root, message: messageOf(err) }
  }
}

/** Prompt for a folder, then open it as a project — or offer to initialize one
 * if it has no `project.json`. Returns typed results rather than throwing. */
async function openProject(): Promise<OpenProjectResult> {
  const win = BrowserWindow.getFocusedWindow()
  const opts: OpenDialogOptions = { properties: ['openDirectory', 'createDirectory'] }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, reason: 'cancelled' }
  }

  const root = result.filePaths[0]
  const opened = await openProjectPath(root)
  if (!opened.ok && opened.reason === 'no-config') return offerCreateProject(root, win)
  return opened
}

/** Guard renderer-supplied paths: must have a project open and stay inside it. */
function guardPath(path: string): boolean {
  return currentProject !== null && isInside(currentProject.root, path)
}

// The failure variant is shared by FileReadResult and WriteResult, so this is
// assignable to both handlers' return types.
const OUTSIDE_ERR = {
  ok: false as const,
  error: 'Path is outside the open project.'
}

// --- IPC handlers (the only surface the renderer can reach) ---
function registerIpc(): void {
  // Phase 0: prove the bridge round-trips.
  ipcMain.handle('ping', () => 'pong')

  // The repo root — used to build a ready-to-paste MCP config in the in-app Help
  // (points a client at this repo's `src/mcp/server.ts`, which runs from source).
  ipcMain.handle('app:dir', (): string => repoRoot())

  // The app's semver (package.json → Electron), shown in the Help panel.
  ipcMain.handle('app:version', (): string => app.getVersion())

  ipcMain.handle('project:open', (): Promise<OpenProjectResult> => openProject())

  ipcMain.handle('project:new', (): Promise<OpenProjectResult> => createProject())

  ipcMain.handle('project:openPath', (_e, root: string): Promise<OpenProjectResult> =>
    openProjectPath(root)
  )

  // Strip the grammar secrets before settings ever reach the renderer — the
  // premium API key lives only in main (Phase 10).
  ipcMain.handle('settings:get', async (): Promise<AppSettings> => {
    const s = await readSettings()
    if (s.grammar && (s.grammar.apiKey || s.grammar.username)) {
      const { apiKey: _k, username: _u, ...safe } = s.grammar
      return { ...s, grammar: safe }
    }
    return s
  })

  // Write an edited project.json back (the Project Settings form). Callers pass
  // the full config so unknown keys (themes, entityTypes) are preserved.
  ipcMain.handle(
    'project:writeConfig',
    async (_e, config: ProjectConfig): Promise<WriteConfigResult> => {
      if (!currentProject) return { ok: false, error: 'No project is open.' }
      const name = config?.project?.name
      if (typeof name !== 'string' || !name.trim()) {
        return { ok: false, error: 'A project name is required.' }
      }
      try {
        await writeProjectConfig(currentProject.root, config)
        return { ok: true, project: setCurrentProject(currentProject.root, config) }
      } catch (e) {
        return { ok: false, error: messageOf(e) }
      }
    }
  )

  // --- external analysis (Phase 10) ---

  // Grammar/style check via LanguageTool HTTP; config (incl. any key) read in main.
  ipcMain.handle('analysis:grammar', (_e, text: string): Promise<GrammarMatch[]> =>
    checkGrammar(text)
  )

  // Language-server engine (M27): sync a doc / close it. Diagnostics come back
  // asynchronously over the 'lsp:diagnostics' push channel (below).
  ipcMain.handle('lsp:sync', (_e, path: string, text: string): Promise<void> =>
    lspSync(path, text)
  )
  ipcMain.handle('lsp:close', (_e, path: string): void => lspClose(path))

  // --- story intelligence (Phase 5) ---

  ipcMain.handle('story:entities', (): Promise<Entity[]> => getEntities())

  ipcMain.handle('story:references', (_e, entity: Entity): Promise<EntityRef[]> => {
    if (!currentProject) return Promise.resolve([])
    const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
    return referencesTo(entity, currentProject.root, ignore)
  })

  ipcMain.handle(
    'story:inspect',
    async (_e, path: string): Promise<FileInspection | null> => {
      if (!currentProject || !guardPath(path)) return null
      return inspectFile(path, await getEntities())
    }
  )

  // Companion pane (M8d): the auto-follow scene set + single-reference loading.
  ipcMain.handle(
    'story:sceneRefs',
    async (_e, path: string): Promise<CompanionEntry[]> => {
      if (!currentProject || !guardPath(path)) return []
      return sceneEntities(path, await getEntities())
    }
  )

  ipcMain.handle(
    'story:loadRef',
    async (_e, path: string): Promise<CompanionEntry | null> => {
      if (!currentProject || !guardPath(path)) return null
      return loadCompanionEntry(path, await getEntities())
    }
  )

  ipcMain.handle('story:threads', (): Promise<Thread[]> => getThreads())

  // Pick an image via a dialog and import it into the project's assets/ folder.
  ipcMain.handle('image:pick', async (): Promise<{ path: string } | null> => {
    if (!currentProject) return null
    const win = BrowserWindow.getFocusedWindow()
    const opts: OpenDialogOptions = {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: IMAGE_EXTS }]
    }
    const res = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts)
    if (res.canceled || !res.filePaths[0]) return null
    return { path: await importImage(res.filePaths[0]) }
  })

  // Import an already-known image file (e.g. dragged onto the editor).
  ipcMain.handle(
    'image:importFile',
    async (_e, sourcePath: string): Promise<{ path: string } | null> => {
      if (!currentProject) return null
      try {
        return { path: await importImage(sourcePath) }
      } catch {
        return null
      }
    }
  )

  ipcMain.handle('story:health', async (): Promise<EntityRef[]> => {
    if (!currentProject) return []
    const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
    return deadReferences(currentProject.root, ignore, await getEntities())
  })

  ipcMain.handle(
    'story:countMentions',
    (_e, surface: string): Promise<{ count: number; files: number }> => {
      if (!currentProject) return Promise.resolve({ count: 0, files: 0 })
      const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
      return countMentions(currentProject.root, ignore, surface)
    }
  )

  ipcMain.handle(
    'story:renameMentions',
    (
      _e,
      from: string,
      to: string,
      skip: string[]
    ): Promise<{ changed: string[]; skipped: string[]; count: number }> => {
      if (!currentProject) {
        return Promise.resolve({ changed: [], skipped: [], count: 0 })
      }
      const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
      return renameMentions(currentProject.root, ignore, from, to, skip)
    }
  )

  // Manual "Reload from Disk": drop the cache so external edits (another editor,
  // a git checkout) are picked up on the next fetch.
  ipcMain.handle('story:refresh', (): void => invalidateStoryIndex())

  ipcMain.handle(
    'settings:update',
    (_e, patch: Partial<AppSettings>): Promise<AppSettings> => updateSettings(patch)
  )

  ipcMain.handle('project:readTree', async (): Promise<TreeNode | null> => {
    if (!currentProject) return null
    const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
    return readTree(currentProject.root, ignore)
  })

  ipcMain.handle('file:read', async (_e, path: string): Promise<FileReadResult> => {
    if (!guardPath(path)) return OUTSIDE_ERR
    try {
      const text = await fs.readFile(path, 'utf8')
      const { mtimeMs } = await fs.stat(path)
      return { ok: true, text, mtimeMs }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  })

  // Write, guarding against clobbering an external edit. `baseMtimeMs` is the
  // on-disk timestamp the tab last saw; if the file is now newer, we refuse and
  // report a conflict so the UI can prompt (overwrite / reload). Passing no
  // baseMtimeMs forces the write (used by the "Overwrite" choice and new files).
  ipcMain.handle(
    'file:write',
    async (
      _e,
      path: string,
      contents: string,
      baseMtimeMs?: number
    ): Promise<WriteFileResult> => {
      if (!guardPath(path)) return OUTSIDE_ERR
      try {
        if (baseMtimeMs != null) {
          const current = await fs.stat(path).catch(() => null)
          // A newer mtime means someone else wrote it since we read it. (A missing
          // file — externally deleted — is not a conflict; the write recreates it.)
          if (current && current.mtimeMs > baseMtimeMs) {
            return { ok: false, conflict: true, diskMtimeMs: current.mtimeMs }
          }
        }
        await fs.writeFile(path, contents, 'utf8')
        const { mtimeMs } = await fs.stat(path)
        invalidateStoryIndex()
        return { ok: true, mtimeMs }
      } catch (err) {
        return { ok: false, error: messageOf(err) }
      }
    }
  )

  // --- explorer file operations (M4) ---

  ipcMain.handle('file:create', async (_e, path: string): Promise<WriteResult> => {
    if (!guardPath(path)) return OUTSIDE_ERR
    try {
      // `wx` fails if the file already exists, so we never clobber content.
      await fs.writeFile(path, '', { encoding: 'utf8', flag: 'wx' })
      invalidateStoryIndex()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  })

  ipcMain.handle('folder:create', async (_e, path: string): Promise<WriteResult> => {
    if (!guardPath(path)) return OUTSIDE_ERR
    try {
      await fs.mkdir(path)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  })

  ipcMain.handle(
    'path:rename',
    async (_e, from: string, to: string): Promise<WriteResult> => {
      if (!guardPath(from) || !guardPath(to)) return OUTSIDE_ERR
      try {
        await fs.rename(from, to)
        invalidateStoryIndex()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: messageOf(err) }
      }
    }
  )

  ipcMain.handle('path:remove', async (_e, path: string): Promise<WriteResult> => {
    if (!guardPath(path)) return OUTSIDE_ERR
    // Deleting the project root would orphan the open project — refuse it.
    if (currentProject && resolve(path) === resolve(currentProject.root)) {
      return { ok: false, error: 'Cannot delete the project root.' }
    }
    try {
      await fs.rm(path, { recursive: true, force: false })
      invalidateStoryIndex()
      return { ok: true }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  })

  // --- manuscript order (M6) ---

  ipcMain.handle(
    'file:setOrder',
    async (_e, path: string, value: number): Promise<WriteResult> => {
      if (!guardPath(path)) return OUTSIDE_ERR
      try {
        const text = await fs.readFile(path, 'utf8')
        await fs.writeFile(path, writeOrder(text, value), 'utf8')
        invalidateStoryIndex()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: messageOf(err) }
      }
    }
  )

  // --- project-wide search & replace (M5) ---

  ipcMain.handle(
    'project:search',
    async (_e, query: string, opts: SearchOptions): Promise<SearchFileResult[]> => {
      if (!currentProject || !query) return []
      const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
      const files = await listMarkdownFiles(currentProject.root, ignore)
      const results: SearchFileResult[] = []
      for (const path of files) {
        let text: string
        try {
          text = await fs.readFile(path, 'utf8')
        } catch {
          continue
        }
        const matches = findMatches(text, query, opts)
        if (matches.length) results.push({ path, matches })
      }
      return results
    }
  )

  ipcMain.handle(
    'project:replace',
    async (
      _e,
      query: string,
      replacement: string,
      opts: SearchOptions
    ): Promise<ReplaceResult> => {
      if (!currentProject) return { ok: false, error: 'No project open.' }
      if (!query) return { ok: true, files: 0, replacements: 0 }
      const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
      const files = await listMarkdownFiles(currentProject.root, ignore)
      let changedFiles = 0
      let total = 0
      try {
        for (const path of files) {
          const text = await fs.readFile(path, 'utf8')
          const { text: next, count } = replaceAll(text, query, replacement, opts)
          if (count > 0) {
            await fs.writeFile(path, next, 'utf8')
            changedFiles++
            total += count
          }
        }
        if (changedFiles > 0) invalidateStoryIndex()
        return { ok: true, files: changedFiles, replacements: total }
      } catch (err) {
        return { ok: false, error: messageOf(err) }
      }
    }
  )

  // --- export / compile (Phase: manuscript export) ---

  // Compile the ordered manuscript scenes into one clean prose string (editorial
  // marks stripped, tracked changes accepted). Returns the text + a scene summary
  // so the renderer can report what it exported and offer to save it.
  ipcMain.handle('export:manuscript', async (): Promise<ExportManuscriptResult> => {
    if (!currentProject) return { ok: false, error: 'No project open.' }
    const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
    try {
      const scenes = await gatherManuscript(currentProject.root, ignore)
      if (!scenes.length) {
        return {
          ok: false,
          error:
            'No ordered manuscript scenes found — add `order:` frontmatter to your scenes.'
        }
      }
      const text = compileManuscript(scenes)
      return {
        ok: true,
        text,
        scenes: scenes.map((s) => ({ title: s.title, order: s.order, path: s.path })),
        wordCount: countManuscriptWords(text)
      }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  })

  // Write a compiled manuscript to disk via a native Save dialog. Separate from
  // the compile step so the renderer can compile/preview without a dialog.
  ipcMain.handle(
    'export:save',
    async (_e, text: string, defaultName: string): Promise<ExportSaveResult> => {
      const win = BrowserWindow.getFocusedWindow()
      const opts = {
        defaultPath: defaultName,
        filters: [
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Plain Text', extensions: ['txt'] }
        ]
      }
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      try {
        await fs.writeFile(result.filePath, text, 'utf8')
        return { ok: true, path: result.filePath }
      } catch (err) {
        return { ok: false, error: messageOf(err) }
      }
    }
  )

  // Compile the manuscript as an EPUB (one chapter per scene, editorial marks
  // stripped) and save it via a native dialog.
  ipcMain.handle('export:epub', async (): Promise<ExportEpubResult> => {
    if (!currentProject) return { ok: false, error: 'No project open.' }
    const ignore = currentProject.config.explorer?.ignore ?? DEFAULT_IGNORE
    try {
      const scenes = await gatherManuscript(currentProject.root, ignore)
      if (!scenes.length) {
        return {
          ok: false,
          error:
            'No ordered manuscript scenes found — add `order:` frontmatter to your scenes.'
        }
      }
      const chapters = scenes.map((s) => ({
        title: s.title,
        markdown: stripEditorial(stripFrontmatter(s.text))
      }))
      const buffer = await buildEpub(
        { title: currentProject.name, identifier: `urn:uuid:${randomUUID()}` },
        chapters
      )
      const win = BrowserWindow.getFocusedWindow()
      const opts = {
        defaultPath: `${currentProject.name}.epub`,
        filters: [{ name: 'EPUB', extensions: ['epub'] }]
      }
      const result = win
        ? await dialog.showSaveDialog(win, opts)
        : await dialog.showSaveDialog(opts)
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      await fs.writeFile(result.filePath, buffer)
      return { ok: true, path: result.filePath, chapters: chapters.length }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  })
}

app.whenReady().then(() => {
  registerAssetProtocol()
  registerIpc()
  // Push LSP diagnostics (M27) to the renderer as the server publishes them.
  setLspDiagnosticsSink((uri, matches) => {
    mainWindow?.webContents.send('lsp:diagnostics', uri, matches)
  })
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Stop any language server before exit so no child process is orphaned.
app.on('will-quit', () => shutdownLsp())

app.on('window-all-closed', () => {
  // macOS apps typically stay alive until Cmd+Q.
  if (process.platform !== 'darwin') app.quit()
})
