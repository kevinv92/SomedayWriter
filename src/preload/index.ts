import { contextBridge, ipcRenderer } from 'electron'

/**
 * The complete surface the renderer is allowed to reach. Every capability the
 * UI gets must be added here explicitly — the renderer never touches `fs` or
 * Node directly. Grows in later phases (readTree, readFile, writeFile, …).
 */
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke('ping')
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
