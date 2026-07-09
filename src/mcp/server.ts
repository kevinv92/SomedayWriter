import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { promises as fs } from 'fs'
import { resolve, relative, sep } from 'path'
import {
  buildEntities,
  buildThreads,
  inspectFile,
  loadCompanionEntry,
  referencesTo
} from '../main/story-index'
import { isInside, listMarkdownFiles, readProjectConfig } from '../main/fs-project'
import { deriveTitle, parseFrontmatter, readOrder } from '../main/frontmatter'
import { findMatches } from '../main/search'
import type { Entity } from '../shared/types'

/**
 * writer-gui MCP server (Phase 11, M28). Exposes the project — files as
 * resources, and the deterministic `StoryIndex` as tools — over the Model
 * Context Protocol so a subscription-authed client (Claude Desktop / Code)
 * reasons over the *real* manuscript. No AI code, no API key, no metered cost:
 * it reuses the exact same index the app does (`src/main/story-index.ts` et al.
 * are pure Node), so answers can't drift from what the editor sees. Writes are
 * routed through the same root guard (`isInside`) as the app's file ops.
 *
 * Runs standalone over stdio (spawned by the client with a project root). NB:
 * stdout is the JSON-RPC channel — all logging goes to stderr.
 */

function getRoot(): string {
  const i = process.argv.indexOf('--root')
  const root =
    (i >= 0 ? process.argv[i + 1] : undefined) ?? process.env.WRITER_PROJECT_ROOT
  if (!root) {
    console.error(
      'writer-gui MCP: no project root. Pass --root <dir> or set WRITER_PROJECT_ROOT.'
    )
    process.exit(1)
  }
  return resolve(root)
}
const ROOT = getRoot()

async function ignoreGlobs(): Promise<string[]> {
  try {
    return (await readProjectConfig(ROOT)).explorer?.ignore ?? []
  } catch {
    return []
  }
}
async function loadEntities(): Promise<Entity[]> {
  return buildEntities(ROOT, await ignoreGlobs())
}
/** Project-relative POSIX path for display. */
function rel(p: string): string {
  return relative(ROOT, p).split(sep).join('/')
}
/** Resolve a client-supplied path inside the project, or null if it escapes. */
function resolveInRoot(p: string): string | null {
  const abs = resolve(ROOT, p)
  return isInside(ROOT, abs) ? abs : null
}
function text(s: string): { content: { type: 'text'; text: string }[] } {
  return { content: [{ type: 'text', text: s }] }
}
/** Resolve a name / alias / `@{surface}` to an entity (case-insensitive). */
function findEntity(entities: Entity[], q: string): Entity | undefined {
  const s = q
    .trim()
    .replace(/^@\{|\}$/g, '')
    .toLowerCase()
  return entities.find(
    (e) => e.name.toLowerCase() === s || e.aliases.some((a) => a.toLowerCase() === s)
  )
}

const server = new McpServer({ name: 'writer-gui', version: '0.1.0' })

// --- Resources: every project file, readable by uri ---------------------------

server.registerResource(
  'file',
  new ResourceTemplate('writer:///{+path}', {
    list: async () => {
      const files = await listMarkdownFiles(ROOT, await ignoreGlobs())
      return {
        resources: files.map((f) => ({
          uri: `writer:///${rel(f)}`,
          name: rel(f),
          mimeType: 'text/markdown'
        }))
      }
    }
  }),
  { title: 'Project file', description: 'A Markdown file in the writer-gui project' },
  async (uri) => {
    const path = decodeURIComponent(uri.pathname.replace(/^\//, ''))
    const abs = resolveInRoot(path)
    if (!abs) throw new Error(`Path escapes the project: ${path}`)
    return {
      contents: [
        { uri: uri.href, text: await fs.readFile(abs, 'utf8'), mimeType: 'text/markdown' }
      ]
    }
  }
)

// --- Tools: the StoryIndex, projected ----------------------------------------

const readOnly = { readOnlyHint: true }

server.registerTool(
  'project_overview',
  {
    title: 'Project overview',
    description:
      'High-level summary of the project: name, file count, entities by type, and thread names. Start here to ground answers about the manuscript.',
    annotations: readOnly
  },
  async () => {
    const [config, entities, files] = await Promise.all([
      readProjectConfig(ROOT).catch(() => null),
      loadEntities(),
      listMarkdownFiles(ROOT, await ignoreGlobs())
    ])
    const byType = new Map<string, number>()
    for (const e of entities) byType.set(e.type, (byType.get(e.type) ?? 0) + 1)
    const threads = entities.filter((e) => e.type === 'thread').map((e) => e.name)
    const lines = [
      `Project: ${config?.project.name ?? rel(ROOT)}`,
      `Root: ${ROOT}`,
      `Markdown files: ${files.length}`,
      `Entities: ${entities.length} (${[...byType].map(([t, n]) => `${n} ${t}`).join(', ')})`,
      threads.length ? `Threads: ${threads.join(', ')}` : 'Threads: none'
    ]
    return text(lines.join('\n'))
  }
)

server.registerTool(
  'search_project',
  {
    title: 'Search the manuscript',
    description:
      'Full-text search across every Markdown file. Returns file:line:column and the matching line.',
    inputSchema: {
      query: z.string().describe('Text to find'),
      caseSensitive: z.boolean().optional()
    },
    annotations: readOnly
  },
  async ({ query, caseSensitive }) => {
    const files = await listMarkdownFiles(ROOT, await ignoreGlobs())
    const out: string[] = []
    for (const f of files) {
      let t: string
      try {
        t = await fs.readFile(f, 'utf8')
      } catch {
        continue
      }
      for (const m of findMatches(t, query, { caseSensitive }))
        out.push(`${rel(f)}:${m.line}:${m.column}  ${m.preview.trim()}`)
    }
    return text(out.length ? out.join('\n') : `No matches for "${query}".`)
  }
)

server.registerTool(
  'list_entities',
  {
    title: 'List entities',
    description:
      'Every entity (characters, locations, items, factions, threads, …) with its type, aliases, and profile path. Optionally filter by type.',
    inputSchema: {
      type: z.string().optional().describe('e.g. character, location, thread')
    },
    annotations: readOnly
  },
  async ({ type }) => {
    let entities = await loadEntities()
    if (type) entities = entities.filter((e) => e.type === type)
    if (!entities.length)
      return text(type ? `No entities of type "${type}".` : 'No entities.')
    return text(
      entities
        .map(
          (e) =>
            `${e.name} — ${e.type}${e.aliases.length ? ` (aka ${e.aliases.join(', ')})` : ''}  [${rel(e.path)}]`
        )
        .join('\n')
    )
  }
)

server.registerTool(
  'find_references',
  {
    title: 'Find references',
    description:
      'Every place an entity is mentioned (explicit @{…} references), by name or alias. Returns file:line:column and the line.',
    inputSchema: { name: z.string().describe('Entity name or alias') },
    annotations: readOnly
  },
  async ({ name }) => {
    const entities = await loadEntities()
    const entity = findEntity(entities, name)
    if (!entity) return text(`No entity named "${name}".`)
    const refs = await referencesTo(entity, ROOT, await ignoreGlobs())
    if (!refs.length) return text(`${entity.name} is never mentioned.`)
    return text(
      [
        `${entity.name} (${entity.type}) — ${refs.length} mention(s):`,
        ...refs.map((r) => `${rel(r.path)}:${r.line}:${r.column}  ${r.preview}`)
      ].join('\n')
    )
  }
)

server.registerTool(
  'definition_of',
  {
    title: 'Definition of',
    description:
      'Resolve a surface form (name / alias / @{…}) to its entity and return that profile — type, summary, and body.',
    inputSchema: { surface: z.string().describe('Name, alias, or @{surface}') },
    annotations: readOnly
  },
  async ({ surface }) => {
    const entities = await loadEntities()
    const entity = findEntity(entities, surface)
    if (!entity) return text(`"${surface}" doesn't resolve to any entity.`)
    const entry = await loadCompanionEntry(entity.path, entities)
    if (!entry) return text(`${entity.name} — profile unreadable at ${rel(entity.path)}.`)
    return text(
      [
        `${entry.title} (${entry.type})  [${rel(entity.path)}]`,
        entity.aliases.length ? `Aliases: ${entity.aliases.join(', ')}` : '',
        entry.summary ? `Summary: ${entry.summary}` : '',
        '',
        entry.body
      ]
        .filter((l) => l !== '')
        .join('\n')
    )
  }
)

server.registerTool(
  'mentions_in',
  {
    title: 'Mentions in a file',
    description:
      'What a file contains: title, manuscript order, threads, word count, and the entities it mentions with counts.',
    inputSchema: { file: z.string().describe('Project-relative path to a .md file') },
    annotations: readOnly
  },
  async ({ file }) => {
    const abs = resolveInRoot(file)
    if (!abs) return text(`Path escapes the project: ${file}`)
    const insp = await inspectFile(abs, await loadEntities())
    if (!insp) return text(`Couldn't read ${file}.`)
    const lines = [
      `${insp.title.value}  [${rel(insp.path)}]`,
      `Order: ${insp.order ?? '—'} · Words: ${insp.wordCount}`,
      insp.threads.length ? `Threads: ${insp.threads.join(', ')}` : 'Threads: none',
      insp.mentions.length
        ? `Mentions:\n${insp.mentions.map((m) => `  ${m.name} (${m.type}) ×${m.count}`).join('\n')}`
        : 'Mentions: none'
    ]
    return text(lines.join('\n'))
  }
)

server.registerTool(
  'thread_beats',
  {
    title: 'Thread beats',
    description:
      'The scenes on a thread, in reading order (per-thread order, then manuscript order). Use to trace or summarise a storyline.',
    inputSchema: { thread: z.string().describe('Thread name or tag') },
    annotations: readOnly
  },
  async ({ thread }) => {
    const entities = await loadEntities()
    const threads = await buildThreads(ROOT, await ignoreGlobs(), entities)
    const q = thread.trim().toLowerCase()
    const t = threads.find((x) => x.name.toLowerCase() === q || x.tag.toLowerCase() === q)
    if (!t)
      return text(
        `No thread "${thread}". Known: ${threads.map((x) => x.name).join(', ')}`
      )
    if (!t.beats.length) return text(`Thread "${t.name}" has no scenes yet.`)
    return text(
      [
        `${t.name}${t.description ? ` — ${t.description}` : ''} (${t.beats.length} beats):`,
        ...t.beats.map((b, i) => `${i + 1}. ${b.title}  [${rel(b.path)}]`)
      ].join('\n')
    )
  }
)

server.registerTool(
  'reading_order',
  {
    title: 'Reading order',
    description:
      'The manuscript scenes in reading order (by frontmatter `order`), for assembling or summarising the whole story.',
    annotations: readOnly
  },
  async () => {
    const files = await listMarkdownFiles(ROOT, await ignoreGlobs())
    const scenes: { order: number; title: string; path: string }[] = []
    for (const f of files) {
      let t: string
      try {
        t = await fs.readFile(f, 'utf8')
      } catch {
        continue
      }
      const order = readOrder(t)
      if (order == null) continue // only ordered files
      if (typeof parseFrontmatter(t).data.type === 'string') continue // skip entity profiles
      scenes.push({ order, title: deriveTitle(t, f), path: f })
    }
    scenes.sort((a, b) => a.order - b.order)
    if (!scenes.length)
      return text('No ordered manuscript scenes (no `order` frontmatter).')
    return text(scenes.map((s) => `${s.order}. ${s.title}  [${rel(s.path)}]`).join('\n'))
  }
)

server.registerTool(
  'read_file',
  {
    title: 'Read a file',
    description: 'Read a project file’s full contents.',
    inputSchema: { path: z.string().describe('Project-relative path') },
    annotations: readOnly
  },
  async ({ path }) => {
    const abs = resolveInRoot(path)
    if (!abs) return text(`Path escapes the project: ${path}`)
    try {
      return text(await fs.readFile(abs, 'utf8'))
    } catch {
      return text(`Couldn't read ${path}.`)
    }
  }
)

server.registerTool(
  'write_file',
  {
    title: 'Write a file',
    description:
      'Overwrite a project file with new contents. Path is guarded to the project root, exactly like the app’s own file ops.',
    inputSchema: {
      path: z.string().describe('Project-relative path'),
      content: z.string().describe('Full new file contents')
    },
    annotations: { readOnlyHint: false, destructiveHint: true }
  },
  async ({ path, content }) => {
    const abs = resolveInRoot(path)
    if (!abs) return text(`Refused: path escapes the project: ${path}`)
    await fs.writeFile(abs, content, 'utf8')
    return text(`Wrote ${content.length} chars to ${rel(abs)}.`)
  }
)

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport())
  console.error(`writer-gui MCP server ready — project: ${ROOT}`)
}
void main()
