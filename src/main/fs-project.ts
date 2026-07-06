import { promises as fs } from 'fs'
import { basename, join, resolve, sep } from 'path'
import type { ProjectConfig, TreeNode } from '../shared/types'

/**
 * Filesystem logic for a project: reading the config, walking the tree, and
 * guarding paths. Node-only (no Electron/React imports) so it stays unit-
 * testable in isolation.
 */

export const CONFIG_FILE = 'project.json'

/** Used when a project declares no `explorer.ignore`. */
export const DEFAULT_IGNORE = ['.git', 'node_modules']

/** Match an entry name against ignore patterns. Supports exact names and a
 * leading `*.ext` glob (e.g. `*.tmp`) — enough for the documented cases. */
function matchesIgnore(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern.startsWith('*.')) return name.endsWith(pattern.slice(1))
    return name === pattern
  })
}

function isProjectConfig(value: unknown): value is ProjectConfig {
  if (typeof value !== 'object' || value === null) return false
  const project = (value as { project?: unknown }).project
  if (typeof project !== 'object' || project === null) return false
  return typeof (project as { name?: unknown }).name === 'string'
}

/** Read and validate `project.json` at a folder root. Throws ENOENT if the file
 * is absent (caller distinguishes "not a project" from "bad project"). */
export async function readProjectConfig(root: string): Promise<ProjectConfig> {
  const raw = await fs.readFile(join(root, CONFIG_FILE), 'utf8')
  const parsed: unknown = JSON.parse(raw)
  if (!isProjectConfig(parsed)) {
    throw new Error('project.json is missing a string "project.name".')
  }
  return parsed
}

/** The config written when initializing a new project. */
export function defaultProjectConfig(name: string): ProjectConfig {
  return {
    project: { name, version: '1' },
    editor: { defaultExtension: 'md', wordWrap: true, diagnostics: false },
    explorer: { ignore: [...DEFAULT_IGNORE] }
  }
}

/** Write `project.json` (pretty-printed). Callers that edit an existing config
 * should pass the object they read back in, so unknown keys are preserved. */
export async function writeProjectConfig(
  root: string,
  config: ProjectConfig
): Promise<void> {
  await fs.writeFile(
    join(root, CONFIG_FILE),
    JSON.stringify(config, null, 2) + '\n',
    'utf8'
  )
}

/** Directories first, then files; alphabetical within each group. (Manuscript
 * `order` sorting arrives with Phase 3 / M6.) */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

async function readChildren(dir: string, ignore: string[]): Promise<TreeNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: TreeNode[] = []
  for (const entry of entries) {
    if (matchesIgnore(entry.name, ignore)) continue
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path,
        type: 'directory',
        children: await readChildren(path, ignore)
      })
    } else if (entry.isFile()) {
      nodes.push({ name: entry.name, path, type: 'file' })
    }
  }
  return sortNodes(nodes)
}

/** Build the explorer tree rooted at `root`, skipping ignored entries. */
export async function readTree(root: string, ignore: string[]): Promise<TreeNode> {
  return {
    name: basename(root),
    path: root,
    type: 'directory',
    children: await readChildren(root, ignore)
  }
}

/** True if `target` is the project root itself or lives under it. The guard
 * against a renderer asking main to read/write outside the open project. */
export function isInside(root: string, target: string): boolean {
  const r = resolve(root)
  const t = resolve(target)
  return t === r || t.startsWith(r + sep)
}
