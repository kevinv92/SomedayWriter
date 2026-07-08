import { promises as fs } from 'fs'
import { basename, join, resolve } from 'path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { OpenDialogOptions } from 'electron'
import type {
  AppSettings,
  CompanionEntry,
  Entity,
  EntityRef,
  FileInspection,
  FileReadResult,
  Thread,
  OpenProjectResult,
  ProjectMeta,
  ReplaceResult,
  SearchFileResult,
  SearchOptions,
  TreeNode,
  WriteResult
} from '../shared/types'
import {
  buildEntities,
  buildThreads,
  inspectFile,
  loadCompanionEntry,
  referencesTo,
  sceneEntities
} from './story-index'
import { addRecentProject, readSettings, updateSettings } from './settings'
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
import { findMatches, replaceAll } from './search'

// The project the renderer is currently allowed to touch. Every file op is
// validated against this root, so a renderer can't reach outside it.
let currentProject: ProjectMeta | null = null

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
    title: 'writer-gui',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // Security: renderer is sandboxed and isolated; no direct Node/fs access.
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Open external links in the OS browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
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
    message: 'Create a new writer-gui project here?',
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

  ipcMain.handle('project:open', (): Promise<OpenProjectResult> => openProject())

  ipcMain.handle('project:new', (): Promise<OpenProjectResult> => createProject())

  ipcMain.handle('project:openPath', (_e, root: string): Promise<OpenProjectResult> =>
    openProjectPath(root)
  )

  ipcMain.handle('settings:get', (): Promise<AppSettings> => readSettings())

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
      return { ok: true, text }
    } catch (err) {
      return { ok: false, error: messageOf(err) }
    }
  })

  ipcMain.handle(
    'file:write',
    async (_e, path: string, contents: string): Promise<WriteResult> => {
      if (!guardPath(path)) return OUTSIDE_ERR
      try {
        await fs.writeFile(path, contents, 'utf8')
        invalidateStoryIndex()
        return { ok: true }
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
}

app.whenReady().then(() => {
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  // macOS apps typically stay alive until Cmd+Q.
  if (process.platform !== 'darwin') app.quit()
})
