import type { AnalysisProvider, Completion, CompletionContext } from '../types'
import type { Entity } from '@shared/types'
import {
  COMMON_FIELDS,
  entityTypeMeta,
  type ResolvedEntityType
} from '@shared/entity-types'
import {
  declaredType,
  frontmatterContextAt,
  frontmatterKeys
} from '../../lib/frontmatter-context'

/**
 * Frontmatter intellisense (Phase 7, M19). Completes inside a profile's leading
 * `---` … `---` block: **attribute keys** (the common keys plus the fields the
 * file's `type` declares) and **their values** — `type:` → the registered entity
 * types, `threads:` → the project's `type: thread` entities, and enum-ish fields
 * → their allowed set. Entirely schema-driven off the M18 registry + StoryIndex,
 * so there's no per-type code; an unknown `type:` falls back to the common keys.
 *
 * It returns `[]` whenever the cursor isn't in a completing frontmatter position,
 * so it composes safely with the `@`-mention provider through the merged source.
 */
export function createFrontmatterProvider(): {
  provider: AnalysisProvider
  setEntityTypes: (types: ResolvedEntityType[]) => void
  setEntities: (entities: Entity[]) => void
} {
  let entityTypes: ResolvedEntityType[] = []
  let entities: Entity[] = []

  /** Common keys + the fields declared by the file's `type` (deduped by name,
   * common first). */
  function fieldsFor(text: string) {
    const type = declaredType(text)
    const declared = type ? entityTypeMeta(type, entityTypes).fields : []
    const seen = new Set<string>()
    return [...COMMON_FIELDS, ...declared].filter((f) => {
      if (seen.has(f.name)) return false
      seen.add(f.name)
      return true
    })
  }

  function completeKey(text: string): Completion[] {
    const present = new Set(frontmatterKeys(text))
    return fieldsFor(text)
      .filter((f) => !present.has(f.name))
      .map((f) => ({
        label: f.name,
        apply: `${f.name}: `,
        detail: f.label ?? f.name,
        type: 'property'
      }))
  }

  function completeValue(text: string, key: string): Completion[] {
    if (key === 'type') {
      return entityTypes.map((t) => ({ label: t.type, detail: t.label, type: 'enum' }))
    }
    if (key === 'threads') {
      // Threads are referenced by any of their surfaces — a kebab alias
      // (`the-case`) or the display name (`The Case`). Offer each so a match
      // appears whichever form the writer types; deduped case-insensitively.
      const out: Completion[] = []
      const seen = new Set<string>()
      for (const e of entities) {
        if (e.type !== 'thread') continue
        for (const surface of [...e.aliases, e.name]) {
          const s = surface.trim()
          if (!s || seen.has(s.toLowerCase())) continue
          seen.add(s.toLowerCase())
          out.push({ label: s, detail: 'thread', type: 'enum' })
        }
      }
      return out
    }
    const field = fieldsFor(text).find((f) => f.name === key)
    return (field?.values ?? []).map((v) => ({ label: v, detail: key, type: 'enum' }))
  }

  const provider: AnalysisProvider = {
    id: 'frontmatter',
    capabilities: ['completion'],
    complete(ctx: CompletionContext): Completion[] {
      const at = frontmatterContextAt(ctx.text, ctx.offset)
      if (!at.in) return []
      return at.kind === 'key' ? completeKey(ctx.text) : completeValue(ctx.text, at.key)
    }
  }

  return {
    provider,
    setEntityTypes: (types) => (entityTypes = types),
    setEntities: (next) => (entities = next)
  }
}
