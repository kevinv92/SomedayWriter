/**
 * New-file entity templates (Phase 7, M20). Turns a resolved entity type into a
 * starter file: a frontmatter skeleton (`type` + `name` + `aliases`, then the
 * type's declared fields) and a heading. Driven entirely by the M18 registry, so
 * "New Location" and "New Faction" differ only in their declared fields — no
 * per-type code.
 */
import type { ResolvedEntityType } from '@shared/entity-types'

/** Build the file contents for a new entity of `def`, titled `name`. Repeated
 * fields seed an empty list; scalar fields seed an empty value ready to fill. */
export function entityTemplate(def: ResolvedEntityType, name: string): string {
  const lines = ['---', `type: ${def.type}`, `name: ${name}`, 'aliases: []']
  for (const field of def.fields) {
    lines.push(field.repeated ? `${field.name}: []` : `${field.name}:`)
  }
  lines.push('---', '', `# ${name}`, '')
  return lines.join('\n')
}
