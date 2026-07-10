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

  // The keys and enums of a `threads:` beat object (Threads v2). Kept here (not the
  // type registry) because a beat isn't an entity type — it's frontmatter shape.
  const THREAD_BEAT_KEYS = ['name', 'pos', 'summary', 'intensity', 'state']
  const THREAD_BEAT_KEY_LABEL: Record<string, string> = {
    name: 'thread this scene belongs to',
    pos: 'order within this thread',
    summary: 'what the thread does here (one line)',
    intensity: 'setup · rise · climax · fall · resolve',
    state: 'opens · closes · touches'
  }
  const INTENSITY = ['setup', 'rise', 'climax', 'fall', 'resolve']
  const STATE = ['opens', 'closes', 'touches']

  /** Thread surfaces (kebab alias + display name), deduped case-insensitively —
   * offered for `threads:` and a beat object's `name:`. */
  function threadSurfaces(): Completion[] {
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
    const out = fieldsFor(text)
      .filter((f) => !present.has(f.name))
      .map((f) => ({
        label: f.name,
        apply: `${f.name}: `,
        detail: f.label ?? f.name,
        type: 'property' as const
      }))
    // A one-shot scaffold for a threaded scene, when `threads:` isn't set yet.
    if (!present.has('threads')) {
      out.push({
        label: 'threads (add a beat)',
        apply: 'threads:\n  - { name:  }',
        detail: 'thread beat scaffold',
        type: 'property'
      })
    }
    return out
  }

  /** Inner keys of a beat object, minus those already typed in it. */
  function completeThreadKey(present: string[]): Completion[] {
    const has = new Set(present)
    return THREAD_BEAT_KEYS.filter((k) => !has.has(k)).map((k) => ({
      label: k,
      apply: `${k}: `,
      detail: THREAD_BEAT_KEY_LABEL[k],
      type: 'property'
    }))
  }

  function completeValue(text: string, key: string): Completion[] {
    if (key === 'type') {
      return entityTypes.map((t) => ({ label: t.type, detail: t.label, type: 'enum' }))
    }
    // `threads:` (bare id) and a beat object's `name:` both take a thread surface.
    if (key === 'threads' || key === 'name') return threadSurfaces()
    if (key === 'intensity')
      return INTENSITY.map((v) => ({ label: v, detail: 'intensity', type: 'enum' }))
    if (key === 'state')
      return STATE.map((v) => ({ label: v, detail: 'state', type: 'enum' }))
    const field = fieldsFor(text).find((f) => f.name === key)
    return (field?.values ?? []).map((v) => ({ label: v, detail: key, type: 'enum' }))
  }

  const provider: AnalysisProvider = {
    id: 'frontmatter',
    capabilities: ['completion'],
    complete(ctx: CompletionContext): Completion[] {
      const at = frontmatterContextAt(ctx.text, ctx.offset)
      if (!at.in) return []
      if (at.kind === 'key') return completeKey(ctx.text)
      if (at.kind === 'threadKey') return completeThreadKey(at.present)
      return completeValue(ctx.text, at.key)
    }
  }

  return {
    provider,
    setEntityTypes: (types) => (entityTypes = types),
    setEntities: (next) => (entities = next)
  }
}
