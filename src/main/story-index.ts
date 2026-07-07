import { promises as fs } from 'fs'
import type { Entity, EntityRef, FileInspection } from '../shared/types'
import { listMarkdownFiles } from './fs-project'
import {
  deriveTitle,
  deriveTitleDetailed,
  parseFrontmatter,
  parseFrontmatterDetailed,
  readOrder
} from './frontmatter'

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * The project-wide story model (SPEC → StoryIndex), in the main process because
 * it must read every file. It's **type-generic**: an entity is any profile file
 * with a `type` in its frontmatter (character in v1; locations/items/… in Phase
 * 7). Answers the queries the providers use — the entity list (completion),
 * references (find-references), and definitions (go-to-definition).
 */

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === 'string')
    : []
}

/** Scan the project's `.md` files and build the entity list from profile files. */
export async function buildEntities(root: string, ignore: string[]): Promise<Entity[]> {
  const files = await listMarkdownFiles(root, ignore)
  const entities: Entity[] = []
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const { data } = parseFrontmatter(text)
    if (typeof data.type !== 'string') continue // not a profile
    const name =
      typeof data.name === 'string' && data.name.trim()
        ? data.name.trim()
        : deriveTitle(text, path)
    entities.push({
      id: path,
      type: data.type,
      name,
      aliases: stringsOf(data.aliases),
      path
    })
  }
  return entities.sort((a, b) => a.name.localeCompare(b.name))
}

/** Every place `entity`'s surface forms (name or any alias) appear in the
 * project, as whole-word matches. Plain-name detection + `@{surface}` mentions.
 * v1 links every unambiguous surface form; genuinely ambiguous ones are left to
 * a later pass. */
export async function referencesTo(
  entity: Entity,
  root: string,
  ignore: string[]
): Promise<EntityRef[]> {
  const surfaces = [entity.name, ...entity.aliases].filter(Boolean)
  if (!surfaces.length) return []
  // Longest first so "Mara Venn" wins over "Mara" at the same spot.
  surfaces.sort((a, b) => b.length - a.length)
  const re = new RegExp(
    `(?<![\\w])(?:${surfaces.map(escapeRegExp).join('|')})(?![\\w])`,
    'g'
  )

  const files = await listMarkdownFiles(root, ignore)
  const refs: EntityRef[] = []
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(line)) !== null) {
        refs.push({
          path,
          line: i + 1,
          column: m.index + 1,
          surface: m[0],
          preview: line.trim()
        })
      }
    }
  }
  return refs
}

function stringListWarnings(data: Record<string, unknown>, key: string): string[] {
  const value = data[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) return [`Couldn't parse \`${key}\` — expected a list.`]
  if (value.some((x) => typeof x !== 'string')) {
    return [`\`${key}\` has non-text entries.`]
  }
  return []
}

/** Entities mentioned in `body`, with per-entity counts. One combined
 * longest-first scan (like `referencesTo`) so "Mara Venn" isn't also counted as
 * "Mara"; `self` (the profile being inspected) is excluded so a file doesn't
 * report mentions of itself. */
function mentionsIn(
  body: string,
  entities: Entity[],
  selfPath: string
): FileInspection['mentions'] {
  const owner = new Map<string, Entity>() // surface → entity (first wins)
  for (const entity of entities) {
    if (entity.path === selfPath) continue
    for (const surface of [entity.name, ...entity.aliases]) {
      if (surface && !owner.has(surface)) owner.set(surface, entity)
    }
  }
  const surfaces = [...owner.keys()].sort((a, b) => b.length - a.length)
  if (!surfaces.length) return []
  const re = new RegExp(
    `(?<![\\w])(?:${surfaces.map(escapeRegExp).join('|')})(?![\\w])`,
    'g'
  )
  const counts = new Map<string, { entity: Entity; count: number }>()
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const entity = owner.get(m[0])
    if (!entity) continue
    const seen = counts.get(entity.id)
    if (seen) seen.count++
    else counts.set(entity.id, { entity, count: 1 })
  }
  return [...counts.values()]
    .map(({ entity, count }) => ({ name: entity.name, type: entity.type, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

/** Manuscript word count: `body` (frontmatter already stripped) with `%%notes%%`
 * removed and `@{mention}` braces unwrapped to their surface — i.e. what the
 * exported prose would contain. */
function countManuscriptWords(body: string): number {
  const prose = body.replace(/%%[^\n]*?%%/g, ' ').replace(/@\{([^}]*)\}/g, '$1')
  return prose.trim().match(/\S+/g)?.length ?? 0
}

/** The read-only model the Inspector pane mirrors (M8b): what the app parses
 * from one file on disk. Reuses the same frontmatter parse + title derivation +
 * mention matching the editor and index use — it never parses independently, so
 * "what the inspector shows" equals "what the app sees". */
export async function inspectFile(
  path: string,
  entities: Entity[]
): Promise<FileInspection | null> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
  const { data, body, warnings } = parseFrontmatterDetailed(text)
  const fieldWarnings = [
    ...stringListWarnings(data, 'threads'),
    ...stringListWarnings(data, 'aliases'),
    ...(data.order !== undefined && typeof data.order !== 'number'
      ? ['Couldn’t parse `order` — expected a number.']
      : []),
    ...(data.type !== undefined && typeof data.type !== 'string'
      ? ['`type` should be text.']
      : [])
  ]
  return {
    path,
    title: deriveTitleDetailed(text, path),
    order: readOrder(text),
    threads: Array.isArray(data.threads)
      ? data.threads.filter((x): x is string => typeof x === 'string')
      : [],
    mentions: mentionsIn(body, entities, path),
    wordCount: countManuscriptWords(body),
    warnings: [...warnings, ...fieldWarnings]
  }
}
