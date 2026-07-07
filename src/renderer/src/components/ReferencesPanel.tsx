import { useEffect, useMemo, useRef, useState } from 'react'
import type { Entity, EntityRef } from '@shared/types'
import { entityTypeMeta, type ResolvedEntityType } from '@shared/entity-types'
import { basename } from '../lib/paths'

interface ReferencesPanelProps {
  entities: Entity[]
  /** Registered entity types (M18), for the entity type badges. */
  entityTypes: ResolvedEntityType[]
  onClose: () => void
  /** Open a mention at its location (path + 1-based line/column) and highlight
   * the matched surface (`length` characters from `column`). */
  onOpenRef: (path: string, line: number, column: number, length: number) => void
  /** Open an entity's profile file (go-to-definition from the picker). */
  onOpenProfile: (entity: Entity) => void
}

/** Group flat references by file, preserving first-seen file order. */
function byFile(refs: EntityRef[]): { path: string; refs: EntityRef[] }[] {
  const groups: { path: string; refs: EntityRef[] }[] = []
  const index = new Map<string, EntityRef[]>()
  for (const ref of refs) {
    let bucket = index.get(ref.path)
    if (!bucket) {
      bucket = []
      index.set(ref.path, bucket)
      groups.push({ path: ref.path, refs: bucket })
    }
    bucket.push(ref)
  }
  return groups
}

/** Find references (Phase 5, M8c). Pick a story entity → every mention of its
 * name or aliases across the manuscript, grouped by file; click a mention to
 * jump to it, or open the entity's profile. Backed by `StoryIndex`
 * (`story:entities` / `story:references`). */
export function ReferencesPanel({
  entities,
  entityTypes,
  onClose,
  onOpenRef,
  onOpenProfile
}: ReferencesPanelProps) {
  const [filter, setFilter] = useState('')
  const [selected, setSelected] = useState<Entity | null>(null)
  const [refs, setRefs] = useState<EntityRef[]>([])
  const [loading, setLoading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards against a slow earlier lookup landing after a newer selection.
  const requestId = useRef(0)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Filter the entity picker by name, alias, or type (case-insensitive).
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase()
    if (!q) return entities
    return entities.filter((e) =>
      [e.name, e.type, ...e.aliases].some((s) => s.toLowerCase().includes(q))
    )
  }, [entities, filter])

  // Selecting an entity loads its references (an event, so done here rather than
  // in an effect). `requestId` drops a stale response if the user re-selects fast.
  const selectEntity = (entity: Entity) => {
    const id = ++requestId.current
    setSelected(entity)
    setRefs([])
    setLoading(true)
    void window.api.storyReferences(entity).then((found) => {
      if (requestId.current !== id) return
      setRefs(found)
      setLoading(false)
    })
  }

  const back = () => {
    requestId.current++ // ignore any in-flight lookup
    setSelected(null)
    setRefs([])
    setLoading(false)
  }

  const groups = useMemo(() => byFile(refs), [refs])

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">Find References</span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      {selected ? (
        <div className="refs-selected">
          <button className="refs-back" title="Back to all entities" onClick={back}>
            ‹ All
          </button>
          <span className="refs-selected__name">{selected.name}</span>
          <button
            className="refs-profile"
            title="Open profile"
            onClick={() => onOpenProfile(selected)}
          >
            Open profile →
          </button>
        </div>
      ) : (
        <div className="search-panel__controls">
          <input
            ref={inputRef}
            className="modal__input"
            placeholder="Filter characters, locations…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && onClose()}
          />
        </div>
      )}

      <div className="search-panel__results">
        {!selected &&
          (matches.length === 0 ? (
            <div className="search-panel__status">
              {entities.length === 0
                ? 'No entities yet. Add a profile file with a `type` in its frontmatter.'
                : 'No matches.'}
            </div>
          ) : (
            matches.map((entity) => (
              <button
                key={entity.id}
                className="refs-entity"
                onClick={() => selectEntity(entity)}
              >
                <span className="refs-entity__name">{entity.name}</span>
                <span className="refs-entity__type">
                  {entityTypeMeta(entity.type, entityTypes).icon} {entity.type}
                </span>
              </button>
            ))
          ))}

        {selected && loading && <div className="search-panel__status">Searching…</div>}

        {selected && !loading && (
          <>
            <div className="search-panel__status">
              {refs.length} mention{refs.length === 1 ? '' : 's'} in {groups.length} file
              {groups.length === 1 ? '' : 's'}
            </div>
            {groups.map((group) => (
              <div key={group.path} className="search-file">
                <div className="search-file__name">{basename(group.path)}</div>
                {group.refs.map((ref, i) => (
                  <button
                    key={`${ref.line}:${ref.column}:${i}`}
                    className="search-match"
                    onClick={() =>
                      onOpenRef(ref.path, ref.line, ref.column, ref.surface.length)
                    }
                  >
                    <span className="search-match__line">{ref.line}</span>
                    <span className="search-match__preview">{ref.preview}</span>
                  </button>
                ))}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  )
}
