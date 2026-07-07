import { promises as fs } from 'fs'
import type { CompanionEntry, Entity, EntityRef, FileInspection } from '../shared/types'
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

/** Entities detected in `body`, with per-entity counts. One combined
 * longest-first scan (like `referencesTo`) so "Mara Venn" isn't also counted as
 * "Mara"; `selfPath` (the file being scanned, if it's a profile) is excluded so a
 * file doesn't report mentions of itself. Sorted by count, then name. */
function detectMentions(
  body: string,
  entities: Entity[],
  selfPath: string
): { entity: Entity; count: number }[] {
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
  return [...counts.values()].sort(
    (a, b) => b.count - a.count || a.entity.name.localeCompare(b.entity.name)
  )
}

function mentionsIn(
  body: string,
  entities: Entity[],
  selfPath: string
): FileInspection['mentions'] {
  return detectMentions(body, entities, selfPath).map(({ entity, count }) => ({
    name: entity.name,
    type: entity.type,
    count
  }))
}

/** A reference's one-line summary for the Companion's collapsed row: an explicit
 * `summary:` frontmatter field, else the first prose line of the body (skipping
 * headings and notes). */
function summarize(data: Record<string, unknown>, body: string): string {
  if (typeof data.summary === 'string' && data.summary.trim()) {
    return data.summary.trim()
  }
  for (const raw of body.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('%%')) continue
    return line.replace(/^[-*]\s+/, '')
  }
  return ''
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

/** Load one Companion reference (M8d) from a file on disk — an entity profile or
 * an arbitrary pinned note. Title/type come from the entity when the path is one;
 * otherwise the derived title and `'note'`. Returns null if unreadable. */
export async function loadCompanionEntry(
  path: string,
  entities: Entity[]
): Promise<CompanionEntry | null> {
  let text: string
  try {
    text = await fs.readFile(path, 'utf8')
  } catch {
    return null
  }
  const { data, body } = parseFrontmatterDetailed(text)
  const entity = entities.find((e) => e.path === path)
  return {
    path,
    title: entity ? entity.name : deriveTitle(text, path),
    type: entity ? entity.type : 'note',
    summary: summarize(data, body),
    body: body.trim()
  }
}

/** The Companion's auto-follow set for the active file (M8d): the entities
 * detected in it, each resolved to a full `CompanionEntry` (read from its own
 * profile) with the in-file occurrence `count`. Sorted by count. */
export async function sceneEntities(
  activePath: string,
  entities: Entity[]
): Promise<CompanionEntry[]> {
  let text: string
  try {
    text = await fs.readFile(activePath, 'utf8')
  } catch {
    return []
  }
  const { body } = parseFrontmatterDetailed(text)
  const detected = detectMentions(body, entities, activePath)
  const out: CompanionEntry[] = []
  for (const { entity, count } of detected) {
    const entry = await loadCompanionEntry(entity.path, entities)
    if (entry) out.push({ ...entry, count })
  }
  return out
}
