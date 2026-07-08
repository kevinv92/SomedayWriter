/**
 * The entity-type registry (Phase 7, M18). Pure, side-effect-free helpers shared
 * across the process boundary: the renderer badges the tree/inspector, drives
 * frontmatter intellisense (M19) and new-file templates (M20) off the resolved
 * list. Built-in defaults ship here so a zero-config project already knows about
 * characters, locations, items, factions and magic systems; `project.json`
 * `entityTypes` merges *over* these (override a field, or add a new type).
 */
import type { EntityFieldDef, EntityTypeDef, ProjectConfig } from './types'

/** A fully-resolved entity type — every display field filled, ready to render. */
export type ResolvedEntityType = {
  type: string
  label: string
  icon: string
  /** Writer icon-set name for the badge (see `Icon.tsx`); themes with currentColor. */
  iconName: string
  color: string
  fields: EntityFieldDef[]
}

/** Frontmatter keys every profile understands, regardless of type. Offered by
 * M19 alongside the type's declared fields. `type`/`name` are single-valued;
 * `aliases`/`threads` are lists; `order` is a number. */
export const COMMON_FIELDS: EntityFieldDef[] = [
  { name: 'type', label: 'Type' },
  { name: 'name', label: 'Name' },
  { name: 'aliases', label: 'Aliases', repeated: true },
  { name: 'order', label: 'Order' },
  { name: 'threads', label: 'Threads', repeated: true }
]

/** Fallbacks for a type with no registry entry (an unknown `type:` value). */
const FALLBACK_ICON = '📄'
const FALLBACK_ICON_NAME = 'tag'
const FALLBACK_COLOR = 'var(--muted, #8b949e)'

/** The built-in types. `character` mirrors Phase 5; the rest generalise it. A
 * type's `fields` are the *extra* keys beyond the common ones — the template and
 * intellisense present common + these. `thread` is included so thread files get
 * the same badge/template treatment (its identity fields live here). */
const DEFAULT_TYPES: EntityTypeDef[] = [
  {
    type: 'character',
    label: 'Character',
    icon: '👤',
    iconName: 'user',
    color: '#6ea8fe',
    fields: []
  },
  {
    type: 'location',
    label: 'Location',
    icon: '📍',
    iconName: 'map-pin',
    color: '#3fb950',
    fields: [{ name: 'region', label: 'Region' }]
  },
  {
    type: 'item',
    label: 'Item',
    icon: '🗡',
    iconName: 'gem',
    color: '#d29922',
    fields: [{ name: 'owner', label: 'Owner' }]
  },
  {
    type: 'faction',
    label: 'Faction',
    icon: '⚔',
    iconName: 'flag',
    color: '#f778ba',
    fields: [{ name: 'leader', label: 'Leader' }]
  },
  {
    type: 'magic-system',
    label: 'Magic System',
    icon: '✨',
    iconName: 'sparkles',
    color: '#a371f7',
    fields: [{ name: 'source', label: 'Source' }]
  },
  {
    type: 'thread',
    label: 'Thread',
    icon: '🧵',
    iconName: 'spool',
    color: '#db6d28',
    fields: [
      { name: 'color', label: 'Colour' },
      { name: 'description', label: 'Description' }
    ]
  }
]

/** Title-case a `kebab-or-single` type id for a default label ("magic-system" →
 * "Magic System"). */
function titleCase(type: string): string {
  return type
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

function normalize(def: EntityTypeDef): ResolvedEntityType {
  return {
    type: def.type,
    label: def.label?.trim() || titleCase(def.type),
    icon: def.icon?.trim() || FALLBACK_ICON,
    iconName: def.iconName?.trim() || FALLBACK_ICON_NAME,
    color: def.color?.trim() || FALLBACK_COLOR,
    fields: def.fields ?? []
  }
}

/**
 * The project's entity types: built-in defaults with `config.entityTypes` merged
 * over them by `type`. A config entry overrides individual display fields of a
 * matching default (and replaces `fields` when it declares them); a config entry
 * with a new `type` is added. Order: defaults first (in their canonical order),
 * then any project-only types in declared order.
 */
export function resolveEntityTypes(config?: ProjectConfig): ResolvedEntityType[] {
  const merged = new Map<string, EntityTypeDef>()
  for (const def of DEFAULT_TYPES) merged.set(def.type, def)
  for (const override of config?.entityTypes ?? []) {
    if (!override?.type) continue
    const base = merged.get(override.type)
    merged.set(override.type, base ? { ...base, ...override } : override)
  }
  return [...merged.values()].map(normalize)
}

/** Look up one type's resolved metadata, synthesising a fallback for an
 * unregistered `type:` value so callers never handle `undefined`. */
export function entityTypeMeta(
  type: string,
  resolved: ResolvedEntityType[]
): ResolvedEntityType {
  return resolved.find((r) => r.type === type) ?? normalize({ type: type || 'unknown' })
}
