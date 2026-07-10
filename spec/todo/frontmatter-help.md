# Frontmatter block — "Edit" affordance & in-pane help

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _ready to build (small)._ Re-scoped now that the structured
**Frontmatter editor** has shipped ([story-model.md](../story-model.md) → Editing
frontmatter, decision #50).

**Intent.** Two small pieces, both leaning on the shipped editor:

1. **An "Edit" chip on the `---` block in the editor** — a one-click jump from
   where you write the frontmatter to the structured form that edits it. This
   replaces the earlier "read-only help popover" idea: the editor pane already
   _is_ the schema-aware surface, so the block should simply **open it**.
2. **The help lives in the editor pane** — schema-aware field hints and a link to
   the full syntax reference belong _in_ the form, next to the controls, rather
   than in a separate popover.

## 1. The block "Edit" chip

Render a small **"✎ Edit"** chip on the leading `---` block using the same
decoration machinery the softened-frontmatter rendering already uses (a widget
`StateField`, like `imageField` / `mentionField`). Clicking it **opens (and
focuses) the Frontmatter pane** — i.e. calls the same `panels.set('frontmatter',
true)` the rail button does.

- **Placement:** a corner chip at the block's top-right, or one that appears only
  when the caret is inside the `---` block (quietest). Must coexist with the
  softened-at-rest rendering and never shift the text.
- **Keyboard:** a command / shortcut ("Edit frontmatter") that does the same, so
  it isn't mouse-only. Reuses the existing panel-toggle plumbing.

## 2. Help inside the pane

The pane already surfaces every field as a labelled control; add the _explanatory_
layer there, rendered from the entity-type registry so it never drifts:

- **Per-field one-line hints** — a `?`-on-hover or a small caption under each label
  (`order` → "reading position"; `pos` → "position on this thread"; the two
  `order`s disambiguated inline). The registry field's `label` is the seed; a
  short `hint`/`help` string per field is the addition.
- **A header "?"** on the pane → opens the existing **Markdown & syntax reference**
  overlay scrolled to the frontmatter section (the deep-dive), so the pane stays
  uncluttered.
- Optionally flag the same schema issues the pane already validates (unknown enum
  values, bad `order`/`threads`) with the "why" from the registry.

## Relationship to neighbours

- **Single schema source.** Hints, the editor's controls, intellisense (M19), and
  templates (M20) all render from the entity-type registry — add a field (and its
  `hint`) once, it shows everywhere.
- Complements, doesn't replace, intellisense (pull-on-type) and the global syntax
  reference (deep-dive). The "Edit" chip is just a shortcut into the editor.

## Open questions

- Chip visibility — always-present vs caret-in-block only.
- Where the per-field `hint` string lives — on the registry `EntityFieldDef`
  (shared) vs a small lookup in the pane.
- Whether the chip should also appear on files with **no** block yet (as an "Add
  frontmatter" entry point) — likely yes, mirroring the pane's empty state.

## Related

- [story-model.md](../story-model.md) → Editing frontmatter — the shipped editor
  this opens into, plus entity types + the fields registry.
- [manuscript.md](../manuscript.md) — `order` / `threads` / `when` (the fields the
  hints disambiguate).
