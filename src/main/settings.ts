import { promises as fs } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import type { AppSettings } from '../shared/types'

/**
 * App/user settings — a single `settings.json` in the OS user-data dir
 * (`app.getPath('userData')`), separate from per-project `project.json`
 * (SPEC → App settings, decision #28). Plain JSON, zero-dep; unknown keys are
 * preserved across reads/writes.
 */

const SETTINGS_FILE = 'settings.json'
const MAX_RECENT = 10

function settingsPath(): string {
  return join(app.getPath('userData'), SETTINGS_FILE)
}

const EMPTY: AppSettings = { recentProjects: [] }

export async function readSettings(): Promise<AppSettings> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(settingsPath(), 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return { ...EMPTY }
    const recent = (parsed as { recentProjects?: unknown }).recentProjects
    return {
      ...EMPTY,
      ...parsed,
      recentProjects: Array.isArray(recent) ? recent : []
    }
  } catch {
    return { ...EMPTY }
  }
}

async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2) + '\n', 'utf8')
}

/** Merge a partial patch into the stored settings (preserving other keys). */
export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await readSettings()), ...patch }
  await writeSettings(next)
  return next
}

/** Record an opened project at the front of the recent list (deduped, capped). */
export async function addRecentProject(
  path: string,
  name: string,
  openedAt: number
): Promise<AppSettings> {
  const settings = await readSettings()
  const rest = settings.recentProjects.filter((p) => p.path !== path)
  const next: AppSettings = {
    ...settings,
    recentProjects: [{ path, name, openedAt }, ...rest].slice(0, MAX_RECENT)
  }
  await writeSettings(next)
  return next
}
