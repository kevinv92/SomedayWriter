import { promises as fs } from 'fs'
import { basename, join, resolve, sep } from 'path'
import type { ProjectConfig, TreeNode } from '../shared/types'
import { readOrder } from './frontmatter'

/**
 * Filesystem logic for a project: reading the config, walking the tree, and
 * guarding paths. Node-only (no Electron/React imports) so it stays unit-
 * testable in isolation.
 */

export const CONFIG_FILE = 'project.json'

/** Used when a project declares no `explorer.ignore`. */
export const DEFAULT_IGNORE = ['.git', 'node_modules']

/** App-internal folders that are *always* hidden and never scanned, regardless
 * of a project's `explorer.ignore` (so existing projects hide them too). */
const ALWAYS_IGNORE = ['.somedaywriter']

/** Match an entry name against ignore patterns. Supports exact names and a
 * leading `*.ext` glob (e.g. `*.tmp`) — enough for the documented cases. */
function matchesIgnore(name: string, patterns: string[]): boolean {
  if (ALWAYS_IGNORE.includes(name)) return true
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

/** SPEC → Manuscript order: directories first (alphabetical); then files with an
 * `order` (ascending, ties by name); then files with no `order` (alphabetical). */
function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    if (a.type === 'directory') return a.name.localeCompare(b.name)
    const ao = a.order
    const bo = b.order
    if (ao != null && bo != null) return ao - bo || a.name.localeCompare(b.name)
    if (ao != null) return -1
    if (bo != null) return 1
    return a.name.localeCompare(b.name)
  })
}

async function readOrderOf(path: string): Promise<number | null> {
  try {
    return readOrder(await fs.readFile(path, 'utf8'))
  } catch {
    return null
  }
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
      const node: TreeNode = { name: entry.name, path, type: 'file' }
      // Manuscript order lives in each .md file's frontmatter (M6).
      if (entry.name.endsWith('.md')) {
        const order = await readOrderOf(path)
        if (order != null) node.order = order
      }
      nodes.push(node)
    }
  }
  return sortNodes(nodes)
}

/** All `.md` file paths under `root`, honouring `ignore` — for project search. */
export async function listMarkdownFiles(
  root: string,
  ignore: string[]
): Promise<string[]> {
  const out: string[] = []
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (matchesIgnore(entry.name, ignore)) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && entry.name.endsWith('.md')) out.push(path)
    }
  }
  await walk(root)
  return out
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
