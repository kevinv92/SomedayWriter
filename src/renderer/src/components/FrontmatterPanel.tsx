import { useRef, useState, type ReactElement } from 'react'
import type { Entity, EntityFieldDef, FieldKind } from '@shared/types'
import { THREAD_INTENSITIES, THREAD_STATES } from '@shared/types'
import {
  COMMON_FIELDS,
  entityTypeMeta,
  resolveFieldKind,
  type ResolvedEntityType
} from '@shared/entity-types'
import { Document, isMap, isSeq } from 'yaml'
import {
  addFrontmatter,
  frontmatterData,
  parseFrontmatterDoc,
  setField,
  writeFrontmatterDoc
} from '../lib/frontmatter-doc'

interface FrontmatterPanelProps {
  /** The active file, or null when no tab is open. */
  path: string | null
  /** The live editor text for the active file. */
  text: string
  /** Apply a new full-text (the `---` block rewritten) to the editor buffer. */
  onApply: (next: string) => void
  /** Project entities — thread ones feed the beat name suggestions. */
  entities: Entity[]
  entityTypes: ResolvedEntityType[]
  onClose: () => void
}

type Beat = {
  name: string
  pos?: number
  intensity?: string
  state?: string
  summary?: string
}

function toBeat(x: unknown): Beat {
  if (typeof x === 'string') return { name: x }
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>
    return {
      name: typeof o.name === 'string' ? o.name : '',
      pos: typeof o.pos === 'number' ? o.pos : undefined,
      intensity: typeof o.intensity === 'string' ? o.intensity : undefined,
      state: typeof o.state === 'string' ? o.state : undefined,
      summary: typeof o.summary === 'string' ? o.summary : undefined
    }
  }
  return { name: '' }
}

/** Emit the bare-id string when a beat has only a name; the object form otherwise. */
function fromBeat(b: Beat): string | Record<string, unknown> {
  const o: Record<string, unknown> = { name: b.name }
  if (b.pos != null) o.pos = b.pos
  if (b.summary) o.summary = b.summary
  if (b.intensity) o.intensity = b.intensity
  if (b.state && b.state !== 'touches') o.state = b.state
  return Object.keys(o).length === 1 ? b.name : o
}

const dedupeFields = (fields: EntityFieldDef[]): EntityFieldDef[] => {
  const seen = new Set<string>()
  return fields.filter((f) => (seen.has(f.name) ? false : (seen.add(f.name), true)))
}

/** A select for an enum field that surfaces a value outside the allowed set
 *  (e.g. `intensity: climaz`) instead of silently dropping it — the bad value
 *  shows as an "unknown" option with a warning border, and picking a real one
 *  fixes it. */
function EnumSelect({
  value,
  options,
  allowEmpty,
  emptyLabel = '—',
  onChange
}: {
  value: string
  options: readonly string[]
  allowEmpty?: boolean
  emptyLabel?: string
  onChange: (v: string) => void
}): ReactElement {
  const bad = value !== '' && !options.includes(value)
  return (
    <select
      className={`fm-ctl${bad ? ' fm-ctl--warn' : ''}`}
      value={value}
      title={bad ? `“${value}” isn't a recognised value` : undefined}
      onChange={(e) => onChange(e.target.value)}
    >
      {allowEmpty && <option value="">{emptyLabel}</option>}
      {bad && <option value={value}>{value} — unknown</option>}
      {options.map((v) => (
        <option key={v} value={v}>
          {v}
        </option>
      ))}
    </select>
  )
}

/**
 * Structured frontmatter editor (frontmatter-editor spec). Renders the active
 * file's `---` block as a schema-driven form — a control per field `kind`, the
 * threads **beat repeater**, and the writer's own keys under "Kept as-is". Every
 * edit rides the `yaml` Document helper, so comments / key order / unknown keys
 * survive and only the touched field re-emits. Text inputs are uncontrolled and
 * commit on blur (smooth typing); discrete controls commit immediately.
 */
export function FrontmatterPanel({
  path,
  text,
  onApply,
  entities,
  entityTypes,
  onClose
}: FrontmatterPanelProps) {
  // Bumped on structural changes (add/remove/move) to remount uncontrolled inputs.
  const [version, setVersion] = useState(0)
  // Collapsed beats (by index) and the in-flight drag source for reordering.
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const dragIndex = useRef<number | null>(null)

  // Each commit re-parses the current text (high-fidelity Document), applies one
  // change, and writes the block back. The editor is the source of truth, so we
  // read/write the live `text` prop — between distinct user events React has
  // flushed the prior edit back into it, so successive commits compose.
  const commit = (mutate: (doc: Document) => void, structural = false): void => {
    const { doc } = parseFrontmatterDoc(text)
    mutate(doc)
    if (structural) setVersion((v) => v + 1)
    onApply(writeFrontmatterDoc(text, doc))
  }

  const { hasBlock, doc } = parseFrontmatterDoc(text)
  const data = frontmatterData(doc)

  const threadNames = [
    ...new Set(
      entities.filter((e) => e.type === 'thread').flatMap((e) => [e.name, ...e.aliases])
    )
  ].sort()

  const type = typeof data.type === 'string' ? data.type : null
  const typeFields = type ? entityTypeMeta(type, entityTypes).fields : []
  const schema = dedupeFields([...COMMON_FIELDS, ...typeFields])
  const schemaNames = new Set(schema.map((f) => f.name))
  const presentSchema = schema.filter((f) => f.name === 'type' || f.name in data)
  const customKeys = Object.keys(data).filter((k) => !schemaNames.has(k))
  const absentSchema = schema.filter((f) => f.name !== 'type' && !(f.name in data))

  // ---- field controls ----
  const setPlain = (key: string, value: unknown): void =>
    commit((d) => setField(d, key, value))

  const emptyFor = (kind: FieldKind, field?: EntityFieldDef): unknown =>
    kind === 'number'
      ? 0
      : kind === 'list' || kind === 'beats'
        ? []
        : kind === 'enum'
          ? (field?.values?.[0] ?? '')
          : ''

  const renderControl = (field: EntityFieldDef): ReactElement | null => {
    const kind = resolveFieldKind(field)
    const key = field.name
    const raw = data[key]
    if (kind === 'beats') return renderBeats()
    if (kind === 'enum' && key === 'type') {
      return (
        <EnumSelect
          value={type ?? ''}
          options={entityTypes.map((t) => t.type)}
          allowEmpty
          emptyLabel="— none —"
          onChange={(v) => setPlain('type', v || undefined)}
        />
      )
    }
    if (kind === 'enum') {
      return (
        <EnumSelect
          value={typeof raw === 'string' ? raw : ''}
          options={field.values ?? []}
          allowEmpty
          onChange={(v) => setPlain(key, v || undefined)}
        />
      )
    }
    if (kind === 'number') {
      return (
        <input
          key={version}
          className="fm-ctl fm-num"
          inputMode="numeric"
          defaultValue={typeof raw === 'number' ? String(raw) : ''}
          onBlur={(e) => {
            const n = e.target.value.trim()
            setPlain(key, n === '' ? undefined : Number(n))
          }}
        />
      )
    }
    if (kind === 'list') {
      const items = Array.isArray(raw) ? raw.map((x) => String(x)) : []
      return (
        <div className="fm-chips">
          {items.map((it, i) => (
            <span className="fm-chip" key={`${it}-${i}`}>
              {it}
              <button
                className="fm-chip__rm"
                title="Remove"
                onClick={() =>
                  commit(
                    (d) =>
                      setField(
                        d,
                        key,
                        items.filter((_, j) => j !== i)
                      ),
                    true
                  )
                }
              >
                ✕
              </button>
            </span>
          ))}
          <input
            key={version}
            className="fm-chips__input"
            placeholder="add…"
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return
              const v = e.currentTarget.value.trim()
              if (v) commit((d) => setField(d, key, [...items, v]), true)
            }}
          />
        </div>
      )
    }
    // text
    return (
      <input
        key={version}
        className="fm-ctl"
        defaultValue={raw == null ? '' : String(raw)}
        onBlur={(e) => setPlain(key, e.target.value === '' ? undefined : e.target.value)}
      />
    )
  }

  // ---- threads beat repeater ----
  function renderBeats(): ReactElement {
    const beats = (Array.isArray(data.threads) ? data.threads : []).map(toBeat)
    // Edit a beat in place. An object beat keeps its YAML style — we set/delete
    // only the touched sub-keys; a bare id is rebuilt (block form) when it gains
    // a field. Either way, sibling beats are never re-emitted.
    const patch = (i: number, p: Partial<Beat>): void =>
      commit((d) => {
        if (isMap(d.getIn(['threads', i], true))) {
          for (const [k, v] of Object.entries(p)) {
            if (k === 'name') d.setIn(['threads', i, 'name'], v)
            else if (v === undefined || v === '' || (k === 'state' && v === 'touches'))
              d.deleteIn(['threads', i, k])
            else d.setIn(['threads', i, k], v)
          }
        } else {
          d.setIn(['threads', i], fromBeat({ ...beats[i], ...p }))
        }
      })
    const remove = (i: number): void => {
      setCollapsed(new Set())
      commit((d) => {
        d.deleteIn(['threads', i])
        const seq = d.get('threads') as { items?: unknown[] } | undefined
        if (seq?.items && seq.items.length === 0) d.delete('threads')
      }, true)
    }
    const add = (): void => {
      setCollapsed(new Set())
      commit((d) => {
        if (d.get('threads') == null) setField(d, 'threads', [])
        d.addIn(['threads'], fromBeat({ name: '' }))
      }, true)
    }
    // Move a beat node (not its value) so every beat keeps its own YAML style.
    const reorder = (from: number, to: number): void => {
      setCollapsed(new Set())
      commit((d) => {
        const seq = d.get('threads', true)
        if (!isSeq(seq) || from === to || to < 0 || to >= seq.items.length) return
        const [item] = seq.items.splice(from, 1)
        seq.items.splice(to, 0, item)
      }, true)
    }
    const move = (i: number, dir: -1 | 1): void => reorder(i, i + dir)
    const toggleCollapse = (i: number): void =>
      setCollapsed((s) => {
        const n = new Set(s)
        if (n.has(i)) n.delete(i)
        else n.add(i)
        return n
      })
    return (
      <div className="fm-beats">
        {beats.map((b, i) => {
          const open = !collapsed.has(i)
          return (
            <div
              className={`fm-beat${open ? '' : ' fm-beat--collapsed'}`}
              key={`${version}-${i}`}
              onDragOver={(e) => {
                if (dragIndex.current != null) e.preventDefault()
              }}
              onDrop={(e) => {
                e.preventDefault()
                const from = dragIndex.current
                dragIndex.current = null
                if (from != null) reorder(from, i)
              }}
            >
              <div className="fm-beat__head">
                <span
                  className="fm-grip"
                  title="Drag to reorder"
                  draggable
                  onDragStart={() => {
                    dragIndex.current = i
                  }}
                  onDragEnd={() => {
                    dragIndex.current = null
                  }}
                >
                  ⋮⋮
                </span>
                <button
                  className="fm-ibtn fm-beat__chev"
                  title={open ? 'Collapse' : 'Expand'}
                  onClick={() => toggleCollapse(i)}
                >
                  {open ? '⌄' : '›'}
                </button>
                <input
                  className="fm-ctl fm-beat__name"
                  list="fm-thread-names"
                  defaultValue={b.name}
                  placeholder="thread…"
                  onBlur={(e) => patch(i, { name: e.target.value.trim() })}
                />
                <button className="fm-ibtn" title="Move up" onClick={() => move(i, -1)}>
                  ▲
                </button>
                <button className="fm-ibtn" title="Move down" onClick={() => move(i, 1)}>
                  ▼
                </button>
                <button className="fm-ibtn" title="Remove beat" onClick={() => remove(i)}>
                  ✕
                </button>
              </div>
              {open && (
                <>
                  <div className="fm-beat__grid">
                    <label className="fm-sub">
                      Pos
                      <input
                        className="fm-ctl fm-num"
                        inputMode="numeric"
                        defaultValue={b.pos != null ? String(b.pos) : ''}
                        onBlur={(e) => {
                          const n = e.target.value.trim()
                          patch(i, { pos: n === '' ? undefined : Number(n) })
                        }}
                      />
                    </label>
                    <label className="fm-sub">
                      Intensity
                      <EnumSelect
                        value={b.intensity ?? ''}
                        options={THREAD_INTENSITIES}
                        allowEmpty
                        onChange={(v) => patch(i, { intensity: v || undefined })}
                      />
                    </label>
                    <label className="fm-sub">
                      State
                      <EnumSelect
                        value={b.state ?? 'touches'}
                        options={THREAD_STATES}
                        onChange={(v) => patch(i, { state: v })}
                      />
                    </label>
                  </div>
                  <label className="fm-sub">
                    Summary
                    <input
                      className="fm-ctl"
                      defaultValue={b.summary ?? ''}
                      onBlur={(e) => patch(i, { summary: e.target.value || undefined })}
                    />
                  </label>
                </>
              )}
            </div>
          )
        })}
        <button className="fm-add" onClick={add}>
          ＋ Add beat
        </button>
      </div>
    )
  }

  const emptyNoFile = (): ReactElement => (
    <div className="fm-empty">
      <p>No file open.</p>
    </div>
  )

  const emptyNoBlock = (): ReactElement => (
    <div className="fm-empty">
      <p>This file has no frontmatter block yet.</p>
      <button
        className="fm-add fm-add--primary"
        onClick={() => {
          const seeds = type ? [] : ['title', 'type']
          setVersion((v) => v + 1)
          onApply(addFrontmatter(text, seeds))
        }}
      >
        ＋ Add frontmatter
      </button>
      <p className="fm-empty__note">
        Inserts a <code>---</code> block with the common fields.
      </p>
    </div>
  )

  const renderForm = (): ReactElement => (
    <div className="fm-form">
      {doc.errors.length > 0 && (
        <div className="fm-banner" role="alert">
          ⚠ This block has a YAML error — some fields may be missing. Fix it in the
          editor.
        </div>
      )}
      {presentSchema.map((f) => (
        <div className="fm-field" key={f.name}>
          <span className="fm-label">{f.label ?? f.name}</span>
          {renderControl(f)}
        </div>
      ))}

      {customKeys.length > 0 && (
        <>
          <div className="fm-sec">Kept as-is</div>
          {customKeys.map((key) => (
            <div className="fm-field" key={key}>
              <span className="fm-label">{key}</span>
              <input
                key={version}
                className="fm-ctl"
                defaultValue={data[key] == null ? '' : String(data[key])}
                onBlur={(e) =>
                  setPlain(key, e.target.value === '' ? undefined : e.target.value)
                }
              />
            </div>
          ))}
        </>
      )}

      {absentSchema.length > 0 && (
        <select
          className="fm-add fm-addfield"
          value=""
          onChange={(e) => {
            const f = absentSchema.find((x) => x.name === e.target.value)
            if (f) setPlain(f.name, emptyFor(resolveFieldKind(f), f))
          }}
        >
          <option value="">＋ Add field…</option>
          {absentSchema.map((f) => (
            <option key={f.name} value={f.name}>
              {f.label ?? f.name}
            </option>
          ))}
        </select>
      )}
    </div>
  )

  // Which view the pane shows — early returns beat a nested ternary in the JSX.
  const renderBody = (): ReactElement => {
    if (!path) return emptyNoFile()
    if (!hasBlock) return emptyNoBlock()
    return renderForm()
  }

  return (
    <div className="search-panel">
      <div className="search-panel__header">
        <span className="search-panel__title">
          Frontmatter
          {path && <span className="fm-file">{path.split('/').pop()}</span>}
        </span>
        <button className="icon-btn" title="Close (Esc)" onClick={onClose}>
          ✕
        </button>
      </div>

      <datalist id="fm-thread-names">
        {threadNames.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>

      <div className="search-panel__results" key={path ?? 'none'}>
        {renderBody()}
      </div>
    </div>
  )
}
