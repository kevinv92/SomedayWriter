import { contextBridge, ipcRenderer } from 'electron'
import type {
  FileReadResult,
  OpenProjectResult,
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

  /** Explorer tree for the open project, or null if none is open. */
  readTree: (): Promise<TreeNode | null> => ipcRenderer.invoke('project:readTree'),

  /** Read a file inside the open project. */
  readFile: (path: string): Promise<FileReadResult> =>
    ipcRenderer.invoke('file:read', path),

  /** Write a file inside the open project. */
  writeFile: (path: string, contents: string): Promise<WriteResult> =>
    ipcRenderer.invoke('file:write', path, contents)
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
