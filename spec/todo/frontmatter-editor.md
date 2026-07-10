# Structured frontmatter editor

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _shipped (v1)_ — steps 1 & 2 built (see Build order). Left: step 3
(in-place validation hints + docs/DECISIONS graduation) and small polish
follow-ups.

**Intent.** Frontmatter has crossed a complexity threshold. A scene can now carry
`type`, `order`, `aliases`, and a `threads:` **array of beat objects**
(`{ name, pos, summary, intensity, state }`), with a proposed `when:` still to
come. Hand-authoring that YAML — indentation, the flow-vs-block object forms, the
`intensity`/`state` enums, which `order` is which — is fiddly and error-prone.
Give the writer a **schema-driven form** that edits the frontmatter through real
inputs (dropdowns, autocomplete, a beat repeater) and writes clean YAML back. The
file stays the source of truth; the form is a two-way view onto its `---` block.

## Decided

- **Placement — a dedicated rail pane** ("Frontmatter"), in the **file-specific
  group** beside Companion / Comments / Debug info. Simplest two-way sync; no
  in-editor widget machinery. (Chosen over the Debug-pane merge and the inline
  block editor.)
- **Availability — any file with readable frontmatter (text/markdown), not gated
  on `type:`.** When a file has **no `---` block yet**, the pane shows an empty
  state with an **"Add frontmatter"** action that inserts a block seeded with the
  common fields (plus the type's fields once a `type:` is chosen).
- **High-fidelity round-trip.** Edit through the **`yaml` Document/CST API**
  (`parseDocument` → mutate nodes → `String(doc)`), so `# comments`, key order,
  and **unknown keys survive untouched** — only the fields you change re-emit.
  Writers keep their own notes/keys in frontmatter, so nothing they didn't touch
  may move.
- **Keyboard-first.** The whole form — including the beat repeater's add / remove
  / reorder — is fully operable without a mouse; it should never trap focus.

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

**Surface — a rail pane** (decided). A file-specific "Frontmatter" entry on the
rail, beside Companion / Comments / Debug info, with its own icon. Shown for any
text/markdown file; for a file with no `---` block, an **empty state** with an
"Add frontmatter" button (see Decided). The pane is the form; the editor stays
the source of truth.

## Write-back & two-way sync

- **Serialize with the `yaml` lib** (already a dep) — replace only the `---` …
  `---` block, leave the body untouched. Through the normal `writeFile` path;
  never a hidden store. Undoable.
- **Two-way** — editing the text updates the form (re-parse on change, debounced);
  editing the form rewrites the block. Must not fight the **softened-at-rest**
  frontmatter rendering or move the caret unexpectedly.
- **Round-trip fidelity — high (decided).** Use the `yaml` **Document/CST**
  (`parseDocument`), mutate only the nodes the form touched, and `String(doc)`
  back. `# comments`, key order, unknown keys, and the writer's bare-id vs object
  choice all survive; untouched lines are byte-stable. This is the promise —
  writers keep notes in frontmatter, so a save must not reflow what they didn't
  edit.
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

## Open questions (remaining — mechanism, not blocking)

- **Two-way sync mechanism** — while the pane is focused it's authoritative;
  re-parse from the text when the doc changes and the form isn't mid-edit
  (debounced). The exact guard against clobbering an in-progress hand edit, and
  coexistence with the softened-at-rest frontmatter rendering, still to pin down.
- **Validation stance** — informational hints (leaning) vs. blocking bad values,
  and how it ties to the Debug info / Inspector frontmatter warnings that already
  flag bad `type` / `order` / `threads`. Natural add: flag bad `intensity` /
  `state` enum values, which are silently dropped today.

## Build order

**Step 1 — shared foundation** · _shipped._

- Move the `intensity` / `state` enum sets into a **single shared source**
  (`shared/types.ts` as `const` arrays, with the union types derived from them),
  and point `frontmatter-provider` + `parseThreadTags` at it so nothing hardcodes
  the lists.
- Add a **`kind`** to registry fields (`entity-types.ts`) — `text` / `number` /
  `enum` / `entity-ref` / `list` / `beats` — and annotate `COMMON_FIELDS`
  (`order`/`pos` → number, `threads` → beats, `aliases` → list, `type` → enum).
- A `---`-block **Document helper** over `yaml` (`parseDocument`; get/set/delete
  that preserve comments + key order + unknown keys; `String(doc)` back, spliced
  into the file), plus a **seed-a-block** builder for the "Add frontmatter" state.
  Unit-tested for round-trip fidelity.

**Step 2 — the pane.** · _shipped (v1)._ Designed in Claude Design
(`preview/frontmatter-pane.html`), then built: `FrontmatterPanel` (controls by
`kind` + the threads beat repeater with add / remove / move, keyboard-operable),
the file-specific **"Frontmatter" rail pane** (`tag` icon) with the "Add
frontmatter" empty state, and two-way binding — the pane reads the live editor
text and writes back a minimal range edit via `EditorHandle.replaceRange`; a beat
edit mutates only that beat's node (`setIn`/`deleteIn`/`addIn`) so siblings stay
byte-stable. _Follow-ups: per-beat collapse, drag-reorder, and the edited beat
keeps its own flow/block style (currently re-emits block)._

**Step 3 — validation + docs.** In-place validation hints (optionally flagging bad
enum values); README + story-model / manuscript pointers; a `DECISIONS.md` entry
for the rail-pane placement + the high-fidelity round-trip promise.

## Related

- [frontmatter-help.md](./frontmatter-help.md) — the read-only sibling.
- [story-model.md](../story-model.md) — entity types + the fields registry; the
  `threads:` beat shape this most helps with.
- [manuscript.md](../manuscript.md) — `order` / `threads` / `when` (the two
  `order`s the form disambiguates by construction).
- [analysis.md](../analysis.md) — the completion/provider machinery the enum sets
  currently live in.
