# Structured frontmatter editor

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _drafting_ (shape below; nothing committed).

**Intent.** Frontmatter has crossed a complexity threshold. A scene can now carry
`type`, `order`, `aliases`, and a `threads:` **array of beat objects**
(`{ name, pos, summary, intensity, state }`), with a proposed `when:` still to
come. Hand-authoring that YAML — indentation, the flow-vs-block object forms, the
`intensity`/`state` enums, which `order` is which — is fiddly and error-prone.
Give the writer a **schema-driven form** that edits the frontmatter through real
inputs (dropdowns, autocomplete, a beat repeater) and writes clean YAML back. The
file stays the source of truth; the form is a two-way view onto its `---` block.

## What exists, and the gap

- **Intellisense (M19, + the Threads v2 object completion)** — completes keys and
  values _while you type_ inside `---`. It's **pull**: you must know to type, and
  you still assemble the YAML by hand.
- **Templates (M20)** — a new-file skeleton per type. One-shot, at creation only.
- **[frontmatter-help.md](./frontmatter-help.md)** — a specced read-only "?" that
  _explains_ this file's fields. Discoverability, not editing.
- **Debug info pane** — already **reads** and displays what the app parsed from
  frontmatter (memberships, order, warnings). Read-only today.

**The gap:** nothing lets you **edit** structured frontmatter through form
controls. Everything above either explains it or completes a token; the writer
still types `- { name: the-case, intensity: climax }` by hand. That's exactly the
shape a form removes.

## The tool — a schema-driven form

Render one field control per schema field, driven **entirely by the entity-type
registry** (`entity-types.ts` — `COMMON_FIELDS` + each type's declared `fields`),
so it never drifts from intellisense/help/templates and a project's custom
types/fields appear for free.

**Field kinds → controls** (the registry field gains a `kind`, or it's inferred):

| Field kind        | Control                                  | Example              |
| ----------------- | ---------------------------------------- | -------------------- |
| text              | text input                               | `name`, `title`      |
| number            | number input                             | `order`, `pos`       |
| enum              | select                                   | `intensity`, `state` |
| entity-ref        | autocomplete over the project's entities | thread `name:`       |
| list of strings   | chip/token input (add/remove)            | `aliases`            |
| **list of beats** | **the threads repeater** (the hard part) | `threads:`           |

**The threads repeater** is the payoff. Each beat is a row: `name` (thread
autocomplete) · `pos` (number) · `intensity` (select) · `state` (select) ·
`summary` (text). Add / remove / reorder beats. Bare-id memberships show as a
collapsed row that expands into the object form on demand. The `intensity` and
`state` option sets come from a **single shared source** (today they're hardcoded
in `frontmatter-provider`; lift them so the form, intellisense, and help all read
one list).

**Placement — decide (see open questions).** Leaning: a **right-pane "Frontmatter"
panel** (rail entry, file-specific like Companion/Comments/Debug) for v1 — the
simplest two-way sync, no in-editor widget machinery. Alternatives: make it the
**editable counterpart of the Debug info pane** (which already surfaces the parsed
frontmatter), or an **inline block editor** that renders _over_ the softened `---`
block in the editor (most elegant, hardest — CM widget + caret/undo interplay).

## Write-back & two-way sync

- **Serialize with the `yaml` lib** (already a dep) — replace only the `---` …
  `---` block, leave the body untouched. Through the normal `writeFile` path;
  never a hidden store. Undoable.
- **Two-way** — editing the text updates the form (re-parse on change, debounced);
  editing the form rewrites the block. Must not fight the **softened-at-rest**
  frontmatter rendering or move the caret unexpectedly.
- **Round-trip fidelity** — preserve unknown keys, key order where practical, and
  the writer's bare-id vs object choice. Comment preservation and exact quoting
  are the sharp edges (plain `yaml` stringify reflows) — scope v1 to "clean
  re-emit; unknown keys kept," flag anything lossy.
- **Validation** — the form knows the schema, so it can flag unknown/malformed
  keys and bad enum values in place, feeding the same channel as the Inspector's
  frontmatter warnings. Decide informational vs. blocking.

## Use cases

- Adding a thread beat: pick the thread from autocomplete, choose `climax` from a
  dropdown, type the summary — no braces, no remembering the enum spelling.
- Reordering / removing beats without hand-editing an array.
- A new writer sees the file's whole shape as labelled fields and just fills them.
- Discovering optional fields (`when`, a type's custom field) because they're
  present as empty controls, not hidden until typed.

## Relationship to neighbours

- **Single schema source.** Editor, help ([frontmatter-help.md](./frontmatter-help.md)),
  templates (M20), and intellisense (M19) all render from the entity-type
  registry — add a field once, it appears in all four. Prerequisite shared work:
  give registry fields a **`kind`** and move the **enum option sets** (intensity,
  state) into the shared registry so every consumer reads one list.
- **Sibling to the help button.** [frontmatter-help.md](./frontmatter-help.md)
  stays the lightweight _read-only_ affordance (explain-in-place); this is the
  _editable_ one. If the editor ships, the help chip can become its entry point
  (a "?" that opens the form) rather than a separate popover — reconcile then.
- Complements, doesn't replace, hand-editing the YAML (always available).

## Open questions

- **Placement** — right-pane panel (v1 lean) vs. editable Debug-info pane vs.
  inline block editor over the `---` region. Pick before building.
- **Two-way sync mechanism** — debounced re-parse; how to avoid clobbering an
  in-progress hand edit, and coexistence with softened-at-rest rendering.
- **YAML round-trip** — comments, key order, quote style, flow vs block form.
  How much fidelity is v1's promise, and what's flagged as lossy.
- **Enum source** — lift `intensity`/`state` (and future enums) into the registry
  vs. a shared consts module; the form and the shipped intellisense should share it.
- **Which files** — only files with (or eligible for) a `type:`? Manuscript scenes
  (for `order`/`threads`) too? Probably both.
- **Validation stance** — informational hints vs. blocking bad values; how it ties
  to the Inspector's existing frontmatter warnings.
- **a11y** — full keyboard authoring of the repeater; the form must not be
  mouse-only.

## Tasks (rough, once placement lands)

- **Shared schema** — `kind` on registry fields; enum sets moved to the shared
  source; a small `parse`/`serialize` for the `---` block over `yaml`.
- **Form runtime** — render controls by kind from the schema; the threads beat
  repeater; two-way binding to the active file.
- **Surface** — the chosen placement (panel / pane / inline) + rail/menu entry.
- **Write-back + validation** — serialize on change; unknown-key preservation;
  in-place warnings.
- **Docs** — README + story-model/manuscript pointers; DECISIONS entry for the
  placement + round-trip-fidelity call.

## Related

- [frontmatter-help.md](./frontmatter-help.md) — the read-only sibling.
- [story-model.md](../story-model.md) — entity types + the fields registry; the
  `threads:` beat shape this most helps with.
- [manuscript.md](../manuscript.md) — `order` / `threads` / `when` (the two
  `order`s the form disambiguates by construction).
- [analysis.md](../analysis.md) — the completion/provider machinery the enum sets
  currently live in.
