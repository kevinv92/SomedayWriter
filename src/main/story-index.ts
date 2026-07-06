import { promises as fs } from 'fs'
import type { Entity, EntityRef } from '../shared/types'
import { listMarkdownFiles } from './fs-project'
import { deriveTitle, parseFrontmatter } from './frontmatter'

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
  const escaped = surfaces.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const re = new RegExp(`(?<![\\w])(?:${escaped.join('|')})(?![\\w])`, 'g')

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
