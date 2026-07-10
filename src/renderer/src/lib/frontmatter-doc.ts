import { Document, parseDocument } from 'yaml'

/**
 * A high-fidelity view of a file's leading `---` frontmatter for the structured
 * editor (frontmatter-editor spec). Everything rides the `yaml` **Document/CST**
 * so a save preserves what the writer didn't touch — `# comments`, key order, and
 * unknown keys all survive; only the fields the form changes re-emit. The body
 * after the block is spliced back byte-for-byte.
 */

// Leading `---` … `---` fence (optional BOM/CRLF); group 1 is the inner YAML.
const FENCE = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/

export type ParsedFrontmatter = {
  /** The parsed block as a mutable Document (empty map when there's no block). */
  doc: Document
  /** Whether the file already had a `---` block. */
  hasBlock: boolean
}

/** Parse a file's leading frontmatter into a mutable Document. A file with no
 *  block yields an empty map Document (so the form can start editing / seeding). */
export function parseFrontmatterDoc(text: string): ParsedFrontmatter {
  const m = text.match(FENCE)
  if (!m) return { doc: new Document({}), hasBlock: false }
  // A block that's all blank/comments parses to null contents; `doc.set` still
  // creates the map on first write, and `frontmatterData`/`emitInner` treat null
  // as empty — so no special-casing is needed here.
  return { doc: parseDocument(m[1]), hasBlock: true }
}

/** Plain-object snapshot of the block, for populating the form's controls. */
export function frontmatterData(doc: Document): Record<string, unknown> {
  const data = doc.toJS() as unknown
  return data && typeof data === 'object' && !Array.isArray(data)
    ? (data as Record<string, unknown>)
    : {}
}

/** Set a field's value (adds the key if new, keeping block order). `undefined`
 *  removes the key — an empty field shouldn't write a dangling `key:`. */
export function setField(doc: Document, key: string, value: unknown): void {
  if (value === undefined) doc.delete(key)
  else doc.set(key, value)
}

/** Remove a field. */
export function deleteField(doc: Document, key: string): void {
  doc.delete(key)
}

/** Re-emit the block from the (mutated) Document and splice it back into the
 *  file, leaving the body unchanged. Prepends a block when none existed. */
export function writeFrontmatterDoc(text: string, doc: Document): string {
  return replaceBlock(text, `---\n${emitInner(doc)}---\n`)
}

/** Insert a fresh block seeded with the given field keys (empty values), for the
 *  "Add frontmatter" empty state. Returns the new file text. */
export function addFrontmatter(text: string, keys: string[]): string {
  const inner = keys.map((k) => `${k}:`).join('\n')
  return replaceBlock(text, `---\n${inner ? `${inner}\n` : ''}---\n`)
}

/** Replace the leading `---` block with `block`, or prepend it when absent. */
function replaceBlock(text: string, block: string): string {
  const m = text.match(FENCE)
  if (m) {
    const start = m.index ?? 0
    return text.slice(0, start) + block + text.slice(start + m[0].length)
  }
  const body = text.replace(/^\uFEFF/, '')
  return body ? `${block}\n${body}` : block
}

/** Inner YAML for the block, always newline-terminated; empty map → nothing. */
function emitInner(doc: Document): string {
  if (doc.contents == null) return ''
  const s = String(doc)
  if (s.trim() === '' || s.trim() === 'null' || s.trim() === '{}') return ''
  return s.endsWith('\n') ? s : `${s}\n`
}
