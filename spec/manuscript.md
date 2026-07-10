# Manuscript: order, hierarchy & editorial marks

_Part of the [SomedayWriter spec](./README.md)._

## Manuscript order

The **manuscript order** is the sequence scenes/chapters are meant to be read in.
It's a first-class concept because three things depend on it: navigation, the
thread visualiser's default x-axis, and export/compile (the assembly spine).

The root frontmatter **`order`** is _this and only this_ — one number per scene,
the order it's **read**. It is not "when the scene happens" and not "where the
scene sits on a thread." Those are separate axes with their own fields; the root
`order` should never be overloaded to mean them.

### Three sequencing axes — don't conflate them

| Axis                | Field                            | Means                                                             | Drives                                               |
| ------------------- | -------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------- |
| **Narrative order** | root `order:`                    | the order the scene is **read/told**                              | tree sort, nav, export spine, braid's default x-axis |
| **Thread order**    | `pos:` inside a `threads:` entry | the scene's position **within one thread's** beats (thread-local) | the "follow a thread" reading order only             |
| **Story-time**      | `when:` _(proposed)_             | when the event **happens in the world** (flashbacks/chronology)   | a story-time axis / told-vs-happened view            |

Rule of thumb: **root `order` = the order it's _read_; per-thread `pos` = the order
it happens _on that thread_; `when` = the order it _happens in the story_.** The
per-thread order lives in [story-model.md](./story-model.md) → threads; `when` is a
proposal in [todo/story-timeline.md](./todo/story-timeline.md). The per-thread key
is **`pos`**, renamed from `order` to end the collision with root `order` (decided
in [todo/improve-threads.md](./todo/improve-threads.md); a clean break while in
preview).

### Storage

- **Source of truth** — a per-file frontmatter `order` value (a number). The
  file on disk is authoritative; there is **no sidecar order index**.
- **Sparse / fractional** — values are spaced (default step **10**: `10, 20,
30…`) so inserting a scene between two others writes a value _between_ them
  (e.g. `15`) — **a single-file write**, never a renumber of the book.
- **Per-directory scope (v1)** — `order` sequences a file among its **siblings
  in the same folder**. The whole-project reading order is the tree walked
  depth-first with each folder's files in `order`. Global cross-folder ordering,
  and ordering of _folders_ themselves, are **out of scope for v1** (see
  _Deferred decisions_).

### Sorting (how the tree renders)

1. **Directories first**, alphabetical — folders are not ordered in v1.
2. Then **files with an `order`**, ascending; ties broken by filename.
3. Then **files with no `order`**, alphabetical — so a fresh, untagged project
   still shows a sensible sequence.
4. The `NN-` numeric filename prefix is **cosmetic**: `order` is the truth, and
   the two may legitimately **diverge** after a reorder. Filenames are **never**
   rewritten to match.

### Reordering (drag in the tree)

- **Drag to reorder** is the only way to set order — **no hand-typing numbers.**
- Dropping a file **between two siblings** sets its `order` to the **midpoint**
  of the neighbours' values (or `last + 10` when dropped at the end) and **writes
  only that one file's frontmatter**. The file is **not** moved or renamed on
  disk.
- **Non-destructive write-back** — only the `order` field changes (inserted if
  absent); title, threads, body text, and the rest of the frontmatter are left
  untouched.
- **Renormalize** — rewrite a folder's files back to `10, 20, 30…` **only** when
  no gap remains between neighbours (the rare escape hatch, and the only case
  that writes more than one file).

### Reorder vs. move (one gesture, disambiguated by drop target)

- Drop **between siblings** → **reorder**: frontmatter `order` write; file stays
  put on disk.
- Drop **onto a folder** → **move**: `rename` on disk (the M4 path); the `order`
  value rides along unchanged and is simply re-interpreted among the
  destination folder's siblings.

This is the same ordering the (now optional) thread-visualiser editing would have
written — so tree-drag reordering covers the core "move things around" need on
its own.

## Manuscript hierarchy (units: scene → chapter → act)

The manuscript is a **tree of units** — a scene, a chapter, an act/part, the book
itself. It's a **general nesting**, not a fixed three levels; a book uses as many
or as few as it needs.

- **Structure = the folder tree.** A unit is a **file** (a leaf — usually a
  scene, or an unsubdivided chapter) or a **folder** (a container — a chapter of
  scenes, an act of chapters). Nest as deep as the book needs; nothing caps or
  requires a level. A chapter can be either a single file _or_ a folder of
  scenes.
- **Sequencing** — `order` sequences a unit among its siblings (per-directory,
  sparse); the whole-book reading order is the tree walked **depth-first**, each
  level in `order`. _(Already built — Phase 3.)_
- **Title** — each unit's display title is derived (heading → frontmatter →
  filename); see _File titles_.
- **Intra-file scenes** — a single chapter file may instead hold several scenes
  separated by a scene break (`* * *` / `#`) — composition _within_ a file, an
  alternative to file-per-scene. Both are valid.
- **Level is implicit now, explicit later.** What makes a folder an "act" vs. a
  "chapter" is its **depth** in the tree — enough for navigation and reading
  order today. An optional **`level: scene | chapter | act | part`** frontmatter
  **override** is _reserved_ for when a book's nesting doesn't match depth, or for
  labelling; it becomes load-bearing at **export/compile** (mapping units to
  heading levels / part breaks / ePub nav — see _Export/compile_). **Not needed
  before then.**
- **Folder-level declaration (reserved).** Folders have no frontmatter, so
  folder-level metadata — the folder's own `order` and title, its `level`, and a
  **default `level` (or `type`) for its children** ("everything in here is a
  chapter") — would live in a **marker file inside the folder**. Two candidate
  conventions, pick at implementation: an **`index.md`** that _is_ the
  folder-unit's own page (its frontmatter + optional lead-in prose, with the
  sibling files as its children), or a hidden **`_folder.md`** meta file. Either
  way it's still an **explicit declaration you write** — not the folder's _name_
  implying anything (identity stays frontmatter-driven, decision-consistent). It
  also becomes the home for **folder ordering** (folders sort alphabetically
  today). Reserved; **not implemented now.**

**Status:** the hierarchy already works via folders + `order` — **no new code**.
This section captures the model so export, the binder, and the thread visualiser
build on it without a rewrite; the explicit `level` field lands with export
design.

## Comments & editorial marks (CriticMarkup)

**Anchored** comments — attached to a specific span, not just dropped in at a
point. Uses **CriticMarkup**, the standard plain-text convention, so comments
live in the `.md` file (no sidecar store) and CodeMirror tracks the anchor for
free as the text around it changes.

- **Syntax** — a comment at a point is `{>> note to self <<}`; attached to a span
  it pairs with a highlight: `{==the harbor smelled of tar==}{>> too much? <<}`.
- **Rendering reuses the squiggle toolbox.** A **decoration** highlights the
  `{==span==}` and dims/hides the `{>> … <<}` syntax (optionally a small 💬
  widget); a **hover tooltip** (CM6's `hoverTooltip`, the _same_ facility the lint
  squiggles use) shows the note; click to edit, or edit the raw text in place.
  Optional extras, all CM-native: a gutter comment marker and a per-file comments
  list (feeds the _Inspector_ pane).
- **Anchor for free** — because the mark is inline text, editing before it moves
  the highlight automatically: **no sidecar store, no offset remapping, no anchor
  drift.** That's why this is far lighter than a Google-Docs margin/threaded
  system (which stays a possible later _display_ layer on top of these marks, not
  the foundation).
- **Two granularities, one family.** `%%…%%` stays the **unanchored** aside (a
  note at a point in the flow); `{>>…<<}` is the **anchored** comment (about a
  span). Both are personal and **stripped on export**.
- **Export** — remove `{>> … <<}` comments entirely and unwrap `{==span==}` to its
  text. (CriticMarkup also defines suggested-edit marks — `{++ins++}`,
  `{--del--}`, `{~~a~>b~~}` — a natural future _tracked-changes_ layer that export
  would accept/reject; out of scope for comments themselves.)
- **Seam fit** — rendering is a codemirror-adapter decoration (like the `%%`
  notes + frontmatter plugins already are); a comments _panel_ would surface
  parsed comments through the analysis facade. No new architecture.
