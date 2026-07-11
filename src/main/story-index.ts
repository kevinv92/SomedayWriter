import { promises as fs } from 'fs'
import { auditWrite, backupBefore } from './audit'
import type {
  CompanionEntry,
  Entity,
  EntityRef,
  FileInspection,
  ManuscriptScene,
  Thread,
  ThreadBeat,
  ThreadIntensity
} from '../shared/types'
import { THREAD_INTENSITIES } from '../shared/types'
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

/** Every place `entity` is mentioned in the project. Mentions are explicit
 * `@{surface}` references (a surface being the entity's name or any alias) —
 * plain prose text is never auto-linked, so there are no false positives. */
export async function referencesTo(
  entity: Entity,
  root: string,
  ignore: string[]
): Promise<EntityRef[]> {
  const surfaces = [entity.name, ...entity.aliases].filter(Boolean)
  if (!surfaces.length) return []
  // Longest first so "@{Mara Venn}" wins over "@{Mara}" at the same spot.
  surfaces.sort((a, b) => b.length - a.length)
  const re = new RegExp(`@\\{(?:${surfaces.map(escapeRegExp).join('|')})\\}`, 'g')

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

/** Project-health check (Phase 9): every `@{surface}` mention whose surface no
 * longer resolves to an entity's name or alias — dead references left by a
 * renamed/removed alias or a typo. Reuses the EntityRef shape. */
export async function deadReferences(
  root: string,
  ignore: string[],
  entities: Entity[]
): Promise<EntityRef[]> {
  const valid = new Set<string>()
  for (const e of entities) {
    valid.add(e.name)
    for (const a of e.aliases) valid.add(a)
  }
  const files = await listMarkdownFiles(root, ignore)
  const out: EntityRef[] = []
  const re = /@\{([^}]*)\}/g
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = re.exec(lines[i])) !== null) {
        const surface = m[1].trim()
        if (surface && !valid.has(surface)) {
          out.push({
            path,
            line: i + 1,
            column: m.index + 1,
            surface,
            preview: lines[i].trim()
          })
        }
      }
    }
  }
  return out
}

/** Count `@{surface}` mentions across the project (for the rename-refactor
 * preview): total occurrences and how many files contain them. */
export async function countMentions(
  root: string,
  ignore: string[],
  surface: string
): Promise<{ count: number; files: number }> {
  const re = new RegExp(`@\\{${escapeRegExp(surface)}\\}`, 'g')
  const files = await listMarkdownFiles(root, ignore)
  let count = 0
  let fileCount = 0
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const matches = text.match(re)
    if (matches) {
      count += matches.length
      fileCount++
    }
  }
  return { count, files: fileCount }
}

/** Rewrite every `@{from}` mention to `@{to}` across the project (the alias
 * rename refactor). `skip` paths (open + unsaved) are reported, not written, so
 * the caller can handle them without clobbering unsaved edits. */
export async function renameMentions(
  root: string,
  ignore: string[],
  from: string,
  to: string,
  skip: string[]
): Promise<{ changed: string[]; skipped: string[]; count: number }> {
  const re = new RegExp(`@\\{${escapeRegExp(from)}\\}`, 'g')
  const replacement = `@{${to}}`
  const skipSet = new Set(skip)
  const files = await listMarkdownFiles(root, ignore)
  const changed: string[] = []
  const skipped: string[] = []
  let count = 0
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const matches = text.match(re)
    if (!matches) continue
    if (skipSet.has(path)) {
      skipped.push(path)
      continue
    }
    const next = text.replace(re, replacement)
    const backup = await backupBefore(root, path)
    await fs.writeFile(path, next, 'utf8')
    void auditWrite(
      root,
      path,
      'rename-refactor',
      next,
      Buffer.byteLength(text, 'utf8'),
      backup
    )
    changed.push(path)
    count += matches.length
  }
  return { changed, skipped, count }
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

/** `threads` accepts a bare id (string) OR a beat object `{ name: … }` (Threads
 *  v2), so it needs its own validation — the string-list check would flag every
 *  object beat as a "non-text entry". Exported for tests. */
export function threadsWarnings(data: Record<string, unknown>): string[] {
  const value = data.threads
  if (value === undefined) return []
  if (!Array.isArray(value)) return ["Couldn't parse `threads` — expected a list."]
  const ok = (x: unknown): boolean =>
    typeof x === 'string' ||
    (typeof x === 'object' &&
      x !== null &&
      !Array.isArray(x) &&
      typeof (x as Record<string, unknown>).name === 'string')
  if (value.some((x) => !ok(x))) {
    return ['`threads` has an entry that isn’t a name or a `{ name: … }` object.']
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
  // Explicit `@{surface}` mentions only — no bare-text auto-linking.
  const re = new RegExp(`@\\{(${surfaces.map(escapeRegExp).join('|')})\\}`, 'g')
  const counts = new Map<string, { entity: Entity; count: number }>()
  let m: RegExpExecArray | null
  while ((m = re.exec(body)) !== null) {
    const entity = owner.get(m[1])
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
    ...threadsWarnings(data),
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

/** A membership parsed from a scene's `threads:` frontmatter (or an inline
 * marker) — the raw material for a beat before it's placed on a thread. */
type ParsedTag = {
  tag: string
  /** Per-thread position, from the `pos` key (Threads v2, renamed from `order`). */
  order: number | null
  summary: string | null
  intensity: ThreadIntensity | null
}

/** Parse a scene's `threads:` frontmatter (M9; extended in Threads v2). Supports
 * the plain form `[rebellion, romance]` and the object form
 * `[{ name: rebellion, pos: 3, summary: '…', intensity: setup }]`.
 * `pos` is the per-thread order (renamed from `order`); unknown enum values are
 * dropped. Malformed entries are ignored. Exported for unit tests. */
export function parseThreadTags(value: unknown): ParsedTag[] {
  if (!Array.isArray(value)) return []
  const out: ParsedTag[] = []
  for (const item of value) {
    if (typeof item === 'string' && item.trim()) {
      out.push({
        tag: item.trim(),
        order: null,
        summary: null,
        intensity: null
      })
    } else if (item && typeof item === 'object') {
      const o = item as Record<string, unknown>
      const name = o.name
      if (typeof name === 'string' && name.trim()) {
        const summary =
          typeof o.summary === 'string' && o.summary.trim() ? o.summary.trim() : null
        out.push({
          tag: name.trim(),
          order: typeof o.pos === 'number' ? o.pos : null,
          summary,
          intensity: THREAD_INTENSITIES.includes(o.intensity as ThreadIntensity)
            ? (o.intensity as ThreadIntensity)
            : null
        })
      }
    }
  }
  return out
}

/** Inline thread markers (Phase 9, M25b): an `<!-- thread:x -->` opening tag in a
 * scene body scopes part of the scene to thread `x`. Here they add the scene to
 * thread `x`'s membership (deduped, unordered, no beat fields); splitting into
 * sub-scene beats at the marker offsets is future work. */
function parseInlineThreadTags(text: string): ParsedTag[] {
  const re = /<!--\s*thread:([\w-]+)\s*-->/g
  const seen = new Set<string>()
  const out: ParsedTag[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const key = m[1].toLowerCase()
    if (!seen.has(key)) {
      seen.add(key)
      out.push({
        tag: m[1],
        order: null,
        summary: null,
        intensity: null
      })
    }
  }
  return out
}

/** Beat ordering within a thread: explicit per-thread order first (nulls last),
 * then manuscript order (nulls last), then title. */
function compareBeats(a: ThreadBeat, b: ThreadBeat): number {
  const ta = a.threadOrder
  const tb = b.threadOrder
  if (ta != null && tb != null && ta !== tb) return ta - tb
  if (ta != null && tb == null) return -1
  if (ta == null && tb != null) return 1
  const ma = a.manuscriptOrder
  const mb = b.manuscriptOrder
  if (ma != null && mb != null && ma !== mb) return ma - mb
  if (ma != null && mb == null) return -1
  if (ma == null && mb != null) return 1
  return a.title.localeCompare(b.title)
}

/** The project-wide thread model (M9): membership + per-thread ordering from each
 * scene's `threads:` frontmatter, with identity (name, colour, description) drawn
 * from an optional `type: thread` entity file (decision #45). Many-to-many — a
 * scene can appear as a beat on several threads. Intersections (scenes on 2+
 * threads) are left for the caller to derive from overlapping beat paths. */
export async function buildThreads(
  root: string,
  ignore: string[],
  entities: Entity[]
): Promise<Thread[]> {
  const files = await listMarkdownFiles(root, ignore)
  const threadEntities = entities.filter((e) => e.type === 'thread')
  const resolve = (tag: string): Entity | undefined => {
    const t = tag.toLowerCase()
    return threadEntities.find(
      (e) => e.name.toLowerCase() === t || e.aliases.some((a) => a.toLowerCase() === t)
    )
  }

  // Collect beats grouped by lowercased tag (the grouping key).
  const groups = new Map<string, { tag: string; beats: ThreadBeat[] }>()
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const { data } = parseFrontmatter(text)
    // Frontmatter `threads:` + inline `<!-- thread:x -->` markers (M25b), deduped.
    const byKey = new Map<string, ParsedTag>()
    for (const t of [...parseThreadTags(data.threads), ...parseInlineThreadTags(text)]) {
      if (!byKey.has(t.tag.toLowerCase())) byKey.set(t.tag.toLowerCase(), t)
    }
    const tags = [...byKey.values()]
    if (!tags.length) continue
    const title = deriveTitle(text, path)
    const manuscriptOrder = readOrder(text)
    for (const { tag, order, summary, intensity } of tags) {
      const key = tag.toLowerCase()
      let group = groups.get(key)
      if (!group) {
        group = { tag, beats: [] }
        groups.set(key, group)
      }
      group.beats.push({
        path,
        title,
        manuscriptOrder,
        threadOrder: order,
        summary,
        intensity
      })
    }
  }

  // Resolve identity (from a type:thread entity file) + sort beats.
  const threads: Thread[] = []
  const resolvedPaths = new Set<string>()
  for (const { tag, beats } of groups.values()) {
    beats.sort(compareBeats)
    threads.push(await buildThread(tag, beats, resolve(tag), resolvedPaths))
  }
  // Include declared threads (a type:thread file) that no scene tags yet.
  for (const entity of threadEntities) {
    if (resolvedPaths.has(entity.path)) continue
    threads.push(await buildThread(entity.name, [], entity, resolvedPaths))
  }

  return threads.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * The manuscript scene spine (Threads v2, #3/#6/#8): every ordered `.md` that is
 * NOT an entity (`type:`), with its path, order, title, and approximate word
 * count, sorted by reading order. The shared source for the threads dashboard's
 * per-thread stats and the word-weighted braid axis.
 */
export async function manuscriptScenes(
  root: string,
  ignore: string[]
): Promise<ManuscriptScene[]> {
  const files = await listMarkdownFiles(root, ignore)
  const scenes: ManuscriptScene[] = []
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const order = readOrder(text)
    if (order == null) continue
    const fm = parseFrontmatter(text)
    if (typeof fm.data.type === 'string') continue // entity, not a scene
    scenes.push({
      path,
      order,
      title: deriveTitle(text, path),
      words: countManuscriptWords(fm.body)
    })
  }
  return scenes.sort((a, b) => a.order - b.order)
}

async function buildThread(
  tag: string,
  beats: ThreadBeat[],
  entity: Entity | undefined,
  resolvedPaths: Set<string>
): Promise<Thread> {
  let name = tag
  let color: string | null = null
  let description = ''
  let path: string | null = null
  if (entity) {
    resolvedPaths.add(entity.path)
    name = entity.name
    path = entity.path
    try {
      const { data, body } = parseFrontmatter(await fs.readFile(entity.path, 'utf8'))
      if (typeof data.color === 'string') color = data.color.trim()
      description = summarize(data, body)
    } catch {
      // entity file vanished mid-scan — keep the tag-only identity
    }
  }
  return { name, tag, color, description, path, beats }
}
