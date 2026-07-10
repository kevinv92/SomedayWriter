# Story model & entity intelligence

_Part of the [SomedayWriter spec](./README.md)._

## Story model & entity intelligence

The signature features — linking a character to everywhere it's mentioned,
tracking story threads — are **deterministic** "language server" features for
prose. They're the prose equivalent of _go-to-definition_ and _find-references_,
where the "symbols" are characters, threads, and other entities. **No AI
required** (AI is split out — see below).

The entity model is **type-generic**: an entity is any profile file with a
`type` (frontmatter), so the same machinery links characters, locations, items,
factions, magic systems, and more. **v1 (Phase 5) ships `character` + threads**;
the generic `EntityProvider` and additional types land in **Phase 7**.

### `StoryIndex` — the project-wide model

Per-file analysis (spellcheck) isn't enough here: to know everywhere a character
appears you must have read the whole project. So we add a **`StoryIndex`** in the
main process that:

- scans all project files and extracts **entities** — type-generic; `character`
  - threads in v1, more types (location, item, …) in Phase 7,
- updates **incrementally** as files change,
- answers queries the providers use: `definitionOf(entity)`, `referencesTo(entity)`,
  `completionsAt(pos)`.

This is the prose analog of a language server's symbol table.

### Declaring entities

How an entity is declared is what keeps linking deterministic (vs. AI guessing):

- **Profile files** (most reliable) — e.g. `characters/mara.md` with frontmatter.
  The file _is_ the entity's "definition." Frontmatter carries a canonical
  `name` plus **`aliases`** — full names, nicknames, epithets. Every surface form
  resolves to the one entity, so a character (`Mara`, `Mara Venn`, `the courier`)
  **and any other entity type** work the same way: a location
  `name: Giant's Rest` with `aliases: [Redhill, the old hill]` means `@{Redhill}`
  and a plain "Giant's Rest" both link to the one place. (Aliases are how
  in-world renaming — migrants' slang vs. the historical name — stays linked.)
- **Plain-name detection** (the natural path for prose) — match any known
  surface form (canonical **or** alias) in ordinary text and link it, no markup.
  This is what handles multi-word names like "Captain Corvin" and "the courier"
  as they read naturally. Genuinely ambiguous cases (an alias shared by two
  characters) are left unlinked in v1 rather than guessed.
- **`@{…}` mentions** (explicit path) — `@{the courier}` forces an unambiguous
  link and drives autocomplete. Braces are required so a mention can span
  **multiple words** (plain `@word` stops at the first space). The text inside
  is the surface form shown in the draft; **export strips the `@{…}` wrapper**,
  leaving clean prose ("the courier"). Use it to disambiguate or to link a form
  the detector wouldn't catch.

### Deterministic providers (behind the same facade)

- **`CharacterProvider`** — `completion` (@-mention names) + `references`
  (every mention) + `definition` (jump to profile).
- **`ThreadProvider`** — see below.

Both just query `StoryIndex`; they add no editor or facade changes.

### Threads

A **thread** is a story line (a subplot, a mystery, a character arc) that runs
across many files. A thread is itself an **entity** (`type: thread`) in
`StoryIndex` — see _Thread identity_ below — with scenes tagged into it.

**Tagging.** Threads are declared by tagging, at two granularities:

- **File-level marker** — frontmatter tags a whole file into one or more threads:

  ```md
  ---
  threads: [rebellion, kelsier-arc]
  ---
  ```

- **Inline / range marker** — a marker inside a file scopes part of it to a
  thread (a scene, not the whole chapter), e.g. a `<!-- thread:romance -->` /
  `<!-- /thread -->` pair or an `@thread(romance)` line. Lets one file feed
  several threads at different points.

**Thread identity — an optional `type: thread` entity, not `project.json`.** A
thread's display name, color, and (its real value) a **description of the arc**
live in an optional profile file like any other entity — `threads/rebellion.md`
with `type: thread`:

```md
---
type: thread
name: Rebellion
color: crimson
---

The slow burn from whispered dissent in the harbor to open revolt.
```

Nothing thread-related sits in `project.json` — that's tool/editor config, not
story content (decision #45). Threads are **zero-ceremony by default**: tagging
`threads: [rebellion]` in scenes just works with defaults; you create the entity
file only when you want to name / colour / describe the thread. Because a thread
is an entity, it gets find-references, go-to-definition, Companion pinning, and an
Inspector view for free — the one thread-specific part is that its **membership**
query scans scene frontmatter (`threads:` lists), not prose mentions.

**Intersecting threads (many-to-many).** A file — or a scene inside it — can
belong to _multiple_ threads at once, and threads freely overlap. `StoryIndex`
models thread membership as many-to-many, so it can also surface **intersection
points**: places where two or more threads co-occur (useful for spotting where
subplots collide or converge).

**Ordering.** A thread has an order independent of the manuscript's file order,
because a subplot's beats may be scattered:

- **Default** — manuscript order (file/scene position on disk / in the tree).
- **Explicit per-thread order** — an optional **`pos`** value on a membership sets
  a beat's position _within that thread_, without moving the file. The same scene
  can be beat 3 of `rebellion` and beat 1 of `romance`. (`pos` is renamed from
  `order` to avoid colliding with the root manuscript `order` — see
  [manuscript.md](./manuscript.md) → "Three sequencing axes".)

  ```md
  ---
  threads:
    - { name: rebellion, pos: 3 }
    - { name: romance, pos: 1 }
  ---
  ```

`ThreadProvider` then offers: **list a thread's beats in thread order**, jump
between consecutive beats, and show a file's thread memberships + nearby
intersections. All deterministic — reads `StoryIndex`, no editor/facade changes.

### Thread visualiser

A visual overview of how threads run through the manuscript — a "braid" view —
that is **also an editor**. You rearrange the story by dragging on the board, and
the changes are written back to the files. The files stay the source of truth;
the board is a two-way view onto them.

**Layout / read side**

- **Layout** — one horizontal **lane per thread**; the shared x-axis is
  manuscript order (chapters/scenes left→right). A beat renders as a node on its
  lane at the position where it occurs.
- **Intersections** — where a scene belongs to multiple threads, the lanes are
  linked at that x (a marker / crossing), making convergences and collisions
  visible at a glance.
- **Ordering toggle** — view by **manuscript order** (default) or follow a single
  thread in its **own order**, highlighting that lane and dimming the rest.
- **Navigation** — click a node → open that file/scene in the editor; the view is
  a navigator, not just a picture.

**Edit side (drag to rearrange) — _stretch / at risk_**

> Editing the braid is now a **stretch goal, not a committed requirement.**
> Tree-drag reordering + `@`-lane frontmatter already let a writer rearrange
> structure and membership without it, so this ships only if the read-only braid
> proves people want to edit _from the board_. Kept here as the intended design
> if it does.

This is the intended way to set order and membership — no hand-typed order
numbers.

- **Drag a node along its lane** → reorder that beat **within the thread** (sets
  its per-thread order).
- **Drag a node between lanes** → **change thread membership** (move it to another
  thread); drop onto empty space in a second lane to **add** a membership so a
  scene sits on multiple threads.
- **Drag off / delete key** → remove a thread membership (the file and its text
  are untouched — only the tag goes).
- **Reorder in manuscript order** → dragging in the manuscript-order view updates
  the scene's position in the binder/tree.

**Write-back & safety**

- Edits are applied by rewriting the affected files' **thread tags** (frontmatter),
  through the normal `window.api.writeFile` path — the board never edits a
  hidden store.
- `StoryIndex` re-derives from the changed files, so the board, `ThreadProvider`,
  and any open editor stay consistent.
- **Undoable** and non-destructive: dragging only ever moves tags/order, never
  prose. A dropped edit can be reverted.

**Live** — rebuilds incrementally as tags change, whether the change came from a
drag on the board or a hand-edit in the text.

Lives as a togglable panel/view (e.g. replacing or overlaying the editor pane),
not always-on. Ships after the deterministic `ThreadProvider` — read-only braid
first, drag-to-edit second.

## Debug info (file details) pane

_Labeled **"Debug info"** in the UI (formerly "Inspector") — the name says what it
is: a diagnostic view._

A togglable side pane that shows **what the app parses from the current file** —
a read-only mirror of the model, primarily a **debugging aid** for when a writer
hand-edits frontmatter incorrectly.

Shows for the active file:

- **Derived title** (and which source won — heading / frontmatter / filename).
- **Manuscript `order`** and the file's position in reading order.
- **Thread memberships** (file-level + inline ranges) with per-thread order.
- **Character mentions** detected in the file (from `StoryIndex`).
- **Word count** (notes/mentions excluded) and diagnostics count.
- **Parse warnings** — the key debug value: malformed frontmatter surfaced as a
  clear message ("couldn't parse `threads` — expected a list"), so a bad edit is
  obvious instead of silently ignored.

Rules:

- **Reads the same parsed model** the editor/index use (`StoryIndex` + the
  analysis facade) — it **never** parses frontmatter independently, so "what the
  inspector shows" always equals "what the app actually sees." That's the whole
  point.
- **Another pane in the multi-pane shell.** The app body already hosts sibling
  panes (tree, editor, project-search); the inspector is one more toggleable
  panel. A proper resizable pane layout is a Phase 6 / M12 concern.
- **Ships in Phase 5** (M8b), once `StoryIndex` produces the parsed data worth
  inspecting; the full YAML frontmatter parse it relies on lands there too
  (deferred from M6).

## Reference companion pane

A side pane that keeps the **story bible at hand while drafting** — the digital
equivalent of the notebook open beside the keyboard, or the character sheet taped
to the monitor. The writer **glances**, they don't switch; it lives in peripheral
vision, read-mostly, and never takes over the editor. Distinct from _tabs_ (the
documents you're **editing**) and from _Find References_ (a search/navigate tool)
— this is what you **consult** while writing. **Ships in Phase 5 (M8d).**

**Two zones, one pane:**

- **📌 Pinned** — anchors the writer freezes (the antagonist, a `themes.md` note,
  the protagonist). They stay **regardless of scene** and **persist per project**
  across restarts. This is the small handful (2–3) of book-long references.
- **In this scene** — **auto-follows** the active file: the entities detected in
  it (reusing M8b's mention engine pointed at "the current file"). As the writer
  moves between chapters/scenes, this zone **repopulates on its own** — no list to
  curate. This is the notebook turning its own pages.

**Behaviour:**

- **Auto-follow is the default; pinning is the exception.** Attention while
  drafting is mostly "who's in this scene," occasionally "hold this one thing." A
  hand-curated pin list would go stale every scene — so the pane fills itself, and
  the writer only pins the few things that matter all the way through. Pin/unpin
  from an entry's pin icon, a "Pin to reference" gesture on a mention in the prose,
  or the References/entity picker.
- **Read-first.** Entries are **collapsed by default with a one-line summary
  showing** (a `summary:` frontmatter field, else the first trait line), so the
  common glance needs no expand. Expanding shows the profile/note text **in place
  — it never navigates the editor** (jumping is go-to-definition's job). A quiet
  **"open full" → tab** promotes a reference to a real editor tab for the rare
  in-draft edit or a long read.
- **Pin anything, not just entities.** A character/location is a rich entry
  (profile + "appears here ×N"); a **theme/motif** is just a note file rendered as
  text. No themes subsystem — pinning a note covers it.
- **The cardinal rule — auto-follow may change _membership_ but must never move
  what the writer is reading.** New scene entities appear (bottom of the zone),
  departed ones fade — but the entry you have **expanded and scrolled stays exactly
  put** until you leave it. Membership updates are **debounced** so the list never
  twitches per keystroke. Scroll/expand state is **remembered per entry** for the
  session; **pinned entries keep it persistently**.

**Rules & scope:**

- **Another pane in the multi-pane shell** (like the tree / inspector / search),
  **drag-resizable** — widen it when leaning on a longer reference. A small pane is
  the right default: the job is a short glance, and narrow even nudges terse,
  well-kept sheets. Genuinely long reading **graduates to a tab** via "open full"
  (tabs preserve their own scroll), so the pane needn't grow.
- **Reads the same model** the editor/index use (`StoryIndex` + the analysis
  facade); it never parses independently.
- **Pins are personal workspace state**, stored **per project in the app-settings
  store** (like sidebar width) — not in the shared `project.json`.
- **v1 scope:** "in this scene" = the **whole active file** (reuses M8b as-is);
  **cursor-proximity** (narrowing to the current scene within a long chapter) is a
  later refinement. Auto-follow + pinning ship together (pinning is what makes the
  pane trustworthy for anchors).
- **Empty states:** no file open → show pinned only; a file with no detected
  entities → a soft "nothing detected here yet" under the auto zone.

**Naming:** toggle it **Companion** to avoid colliding with the _References_
(find-references) panel — one is what you keep beside you, the other is a search.
