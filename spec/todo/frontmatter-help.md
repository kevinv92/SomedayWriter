# In-editor frontmatter help

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _needs design_ (drafting the shape; nothing committed).

**Intent.** Frontmatter is getting richer — entity `type:` + per-type fields,
`aliases:`, `threads:` growing into beat objects (`name` / `pos` / `summary` /
`intensity` / `state`), a proposed `when:`, and the [two `order`s](../manuscript.md).
A casual or new writer won't memorise that. Put a small **help affordance right at
the frontmatter block in the editor** that opens **schema-aware help for _this_
file** — so the fields explain themselves where you write them.

> **Sibling:** the _editable_ counterpart is
> [frontmatter-editor.md](./frontmatter-editor.md) — a schema-driven form. This
> spec stays the lightweight read-only affordance; if the editor ships, this "?"
> can become its entry point. Both render from the one schema registry.

## What exists, and the gap

- **Intellisense (M19)** — `frontmatter-provider` offers key/value completions
  _while you type inside_ `---`. Great, but it's **pull**: you have to know a
  field exists (or that you can type) to summon it.
- **The entity-type registry** — `entity-types.ts` already holds the **schema**:
  `COMMON_FIELDS` (type, name, aliases, …) plus each type's declared `fields`
  (e.g. location → `region`). This is machine-readable and is _already_ the source
  for templates + intellisense — so help rendered from it can **never drift**.
- **The global syntax reference** — the Markdown & syntax cheat-sheet overlay. It
  covers frontmatter, but it's whole-app and static, not "the fields valid for
  _this_ character file."

**The gap:** nothing shows, in place, _"for this file's `type`, here are the
fields you can use, what each means, and an example"_ — which is exactly the
friction that grows as the schema grows.

## The affordance — a help button in the editor

Render a small **"?" chip on the frontmatter block** using the same decoration
machinery the editor already uses (`frontmatterPlugin`, and widget `StateField`s
like `imageField` / `mentionField`). Placement options to choose between:

- **A corner chip that appears only when the caret is inside the `---` block**
  (quietest; discoverable exactly when relevant). _Leaning this way._
- A subtle always-present chip at the block's top-right.
- A gutter marker on the `---` lines.

Clicking it opens the frontmatter help (a **popover anchored to the block**, or
the existing reference overlay scrolled to a frontmatter section — popover is more
contextual). It must coexist with the **softened-at-rest** frontmatter rendering
and never shift the text.

## What the help shows (the valuable part)

Read the file's `type:` and render from the registry:

- **Common fields** — `title`, `type`, `name`, `aliases`, and (for manuscript
  scenes) `order`, `threads`, `when` — each with a one-line purpose + a tiny
  example.
- **This type's fields** — e.g. a `location` shows `region`, whatever the project
  declared; a `thread` shows its identity fields. Pulled straight from
  `resolveEntityTypes`, so a project's custom types/fields appear automatically.
- **The `threads:` shape** — the one that's getting complex — shown expanded:
  bare id vs `{ name, order, summary, intensity }` (a **beat** is the scene's
  appearance on a thread; `summary`/`intensity` describe it — see
  [story-model.md → Thread views](../story-model.md) #1), with the
  [order disambiguation](../manuscript.md) inline so nobody confuses the two
  `order`s.
- **Actions** — "insert this field" (reuses the template/intellisense path) and a
  link to the full reference + the relevant spec.

## Use cases

- New writer opens a **character** file, doesn't know what belongs there → clicks
  **?** → sees `type / name / aliases` + this type's fields, each with an example.
  No trip to the docs.
- A writer wiring up **threads** with the new `summary` / `order` → **?** shows
  the object shape and which `order` is which.
- Discovering **`when`** (story-time) exists at all — in-place help is how an
  optional field gets found without reading a spec.

## Relationship to neighbours

- **Single schema source.** Help, templates (M20), and intellisense (M19) should
  all render from the **entity-type registry** — add a field once, it shows up in
  all three. This feature is largely "surface the registry as readable help."
- Complements, doesn't replace, intellisense (pull-on-type) and the global
  reference (deep-dive).

## Open questions

- **Visibility** — caret-in-block only, or always-present? Does it show for
  _every_ file or only ones with (or eligible for) a `type:`?
- **Popover vs. overlay** — a small anchored popover, or reuse the full reference
  overlay filtered to frontmatter?
- **Validation** — should the same surface also **flag unknown / malformed keys**
  (it already knows the schema), or stay purely informational? (Ties to the
  Inspector's frontmatter warnings.)
- **Access** — keyboard trigger + a11y; the chip shouldn't be mouse-only.
- Does "insert field" write a stub value, and how does it interact with the
  softened-at-rest rendering?

## Related

- [frontmatter-editor.md](./frontmatter-editor.md) — the editable sibling (a form).
- [story-model.md](../story-model.md) — entity types + the fields registry.
- [manuscript.md](../manuscript.md) — `order` / `threads` / `when` fields.
- [story-model.md → Thread views](../story-model.md) — the richer `threads:` this helps with.
