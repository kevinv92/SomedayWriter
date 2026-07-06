# writer-gui — Spec

A desktop writing tool for prose projects (novels, scripts, docs). Built on
Electron. A project is a folder on disk that contains a `project.json`; the app
opens that folder, shows its files in a tree on the left, and edits the selected
file on the right.

## Goals

- Open a folder as a **Project** and browse its files.
- Edit **Markdown (`.md`) files only** with a clean, distraction-light editor.
- Keep everything as ordinary files on disk — no proprietary database, no lock-in.

## Non-goals (for now)

- **Non-Markdown files.** v1 edits `.md` only. Other files may appear in the tree
  (greyed / read-only or ignored), but the editor, analysis, and story features
  target Markdown.
- Real-time collaboration / cloud sync.
- Rich WYSIWYG formatting beyond Markdown.
- Version control UI (the folder can be a git repo, but the app doesn't manage it).

## Tech stack

- **Electron** — desktop shell (main + renderer processes).
- **Renderer UI**: React + TypeScript + Vite.
- **Editor**: **CodeMirror 6** (Markdown source mode) — committed. Chosen for a
  keyboard-first stance and real **Vim mode** (`@replit/codemirror-vim`), which
  the prose-model editors lack. The editor sits behind an **`EditorAdapter`**
  seam (below) so the choice is reversible at low cost.
- **Project config**: `project.json` — parsed with native `JSON`, no extra
  dependency. (Could move to TOML later if hand-editing ergonomics matter.)
- **File I/O**: Node `fs` in the main process, exposed to the renderer over a
  typed IPC bridge (`contextIsolation: true`, no `nodeIntegration` in the renderer).

## What defines a "Project"

A directory is a Project if it contains a `project.json` at its root. Opening a
folder without one offers to create it (initialize a new project).

### `project.json`

```json
{
  "project": {
    "name": "My Novel",
    "version": "1"
  },
  "editor": {
    "defaultExtension": "md",
    "wordWrap": true,
    "diagnostics": false
  },
  "explorer": {
    "ignore": [".git", "node_modules", "*.tmp"]
  }
}
```

- `project.name` is required; everything else has defaults.
- Unknown keys are preserved on save (don't clobber fields the app doesn't know).

## Layout

```
┌───────────────────────────────────────────────┐
│  Title bar / project name                      │
├──────────────┬────────────────────────────────┤
│              │                                │
│  File        │        Editor                  │
│  Explorer    │      (selected file)           │
│  (tree)      │                                │
│              │                                │
├──────────────┴────────────────────────────────┤
│  Status bar: file path · word count · saved?  │
└───────────────────────────────────────────────┘
```

- **Left — File Explorer**: tree of the project folder. Click a file to open it
  in the editor. Respects `[explorer].ignore`. Resizable divider between panes.
- **Right — Editor**: shows the selected file's contents. Edits are in-memory
  until saved. **v1 has a single active editor**, but the state model treats the
  open document as one entry in a collection so multiple simultaneous editors
  (split view / tabs) can be added later without a rewrite.

## EditorAdapter — the editor seam

The app is **committed to CodeMirror 6**, but nothing outside one module knows
that. Everything else talks to the editor through a thin **`EditorAdapter`**
interface — the same isolation trick as `AnalysisService`, applied to the editor
itself. This keeps a future editor swap contained to one implementation.

Implemented in Phase 1 (`src/renderer/src/editor/`): the interface and shared
types live in `editor-adapter.ts` / `types.ts`; `codemirror-adapter.ts` is the
only file that imports CodeMirror.

```ts
interface EditorAdapter {
  // Lifecycle
  mount(parent: HTMLElement): void
  dispose(): void

  // Content — Markdown text is the canonical representation in/out
  loadDoc(doc: EditorDoc): void // { uri, text }
  getText(): string
  onChange(cb: (text: string) => void): () => void // returns an unsubscribe fn

  // Analysis surface (what AnalysisService drives)
  setDiagnostics(diags: Diagnostic[]): void // squiggles (off by default)
  setCompletionSource(source: CompletionSource | null): void // pull-based intellisense

  // Navigation (visualiser / references click-to-open)
  focusRange(range: Range): void
  getCursor(): CursorPosition

  // Editing UX
  setVimMode(on: boolean): void
}
```

Rules that keep the seam cheap:

- **Markdown text is canonical.** Every editor is fed Markdown and returns
  Markdown, so the on-disk "plain files, no lock-in" contract never depends on
  the editor. Any WYSIWYG serialization would live _inside_ an adapter, not leak
  out.
- **Only the adapter imports CodeMirror.** Providers, `StoryIndex`, the tree, and
  the visualiser never reference the editor library directly.
- **Swap cost is bounded** to re-implementing this interface (+ re-doing Vim and
  the `@mention` UI). See _Decision history — Editor choice_ for the analysis.

## Core features (v1)

1. **Open Project** — pick a folder; read `project.json`; render the tree.
2. **New Project** — pick an empty/plain folder; write a default `project.json`.
3. **Browse** — expand/collapse folders, open files.
4. **Edit** — type in the editor; unsaved changes marked (dot on tab / status bar).
5. **Save** — explicit only in v1: `Cmd/Ctrl+S` writes the active file to disk.
6. **File operations** — from the explorer (context menu / toolbar):
   **new file**, **new folder**, **rename**, **delete**.
7. **Word count** — live count for the active file in the status bar.
8. **Search** — in-document find/replace (`Cmd/Ctrl+F`), project-wide find &
   replace (`Cmd/Ctrl+Shift+F`), a fuzzy-file **Quick Open** (`Cmd/Ctrl+P`), and
   a **Command Palette** (`Cmd/Ctrl+Shift+P`). See
   [Search, quick-open & command palette](#search-quick-open--command-palette).
   _Near-essential; a writer needs find/replace on day one (find a phrase, rename
   a place everywhere)._
9. **Reorder & manuscript order** — an explicit ordering of scenes/chapters,
   editable by **drag in the tree**. Order is the spine the visualiser x-axis and
   any future export both read. _Near-essential._

Order is stored per file (frontmatter `order`, sparse/fractional so a single
insert is one write) — see [Manuscript order](#manuscript-order).

## Manuscript order

The **manuscript order** is the sequence scenes/chapters are meant to be read in.
It's a first-class concept because three things depend on it: navigation, the
thread visualiser's x-axis, and any future export/compile.

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

## Search, quick-open & command palette

Four keyboard-first surfaces, modeled on VS Code. All open on a shortcut, filter
as you type, and dismiss with `Esc`.

- **In-document find/replace — `Cmd/Ctrl+F`** _(M5)._ Find and replace within the
  open file. CodeMirror's `search` extension + `searchKeymap`, wired **through
  the `EditorAdapter`** (the app never imports CM directly). Case / whole-word /
  regex toggles as the extension provides.
- **Project-wide find & replace — `Cmd/Ctrl+Shift+F`** _(M5)._ Search text across
  all `.md` files (respecting `explorer.ignore`); results grouped by file,
  click-to-open at the match; replace across selected matches. Runs in **main**
  (it reads every file) behind a typed `window.api` method.
- **Quick Open — fuzzy file finder — `Cmd/Ctrl+P`** _(Phase 6)._ Type part of a
  filename; a fuzzy-ranked list of project files; `Enter` opens. The fast way to
  jump between scenes without walking the tree.
- **Command Palette — `Cmd/Ctrl+Shift+P`** _(Phase 6)._ Fuzzy-search every
  registered command (New File, Open Project, Toggle Vim, Toggle Diagnostics,
  Reorder…, Save, …) and run it. As in VS Code, **one quick-input widget backs
  both**: Quick Open is filename mode; a leading `>` switches it to command mode.

**Command registry (the seam behind the palette).** Commands are declared once in
a central registry — `{ id, title, keybinding?, run() }` — and **every** trigger
draws from it: the palette, any menus, and keyboard shortcuts. Adding a command
must not touch palette or menu code (same pluggability stance as
`AnalysisService`), and keybindings get a single source of truth. **Fuzzy
matching** is a small subsequence scorer over filenames / command titles — no
heavy dependency.

## Process / IPC design

- **Main process** owns all filesystem access and the current project state.
- **Preload** exposes a minimal, typed API on `window.api`, e.g.:
  - `openProjectDialog(): Promise<ProjectMeta | null>`
  - `readTree(root): Promise<TreeNode>`
  - `readFile(path): Promise<string>`
  - `writeFile(path, contents): Promise<void>`
  - `createFile(path)` / `createFolder(path)` / `rename(from, to)` / `remove(path)`
  - `readProjectConfig(root): Promise<ProjectConfig>`
- Renderer never touches `fs` directly.

## Analysis — pluggable language intelligence

Active feedback (errors/squiggles + intellisense) follows the LSP model, but the
editor never talks to a concrete engine. It talks to one stable facade; the
intelligence behind it is **pluggable**. v1 ships lightweight in-app providers;
a full external LSP client can be dropped in later as just another provider,
with no editor changes.

### Layers

```
CodeMirror 6                AnalysisService              Providers (pluggable)
 (lint + autocomplete) ──►  (facade / registry)  ──►  ┌───────────────────────┐
        ▲                         │                   │ SpellProvider         │
        │  diagnostics (push)     │  fan-out /         │ StyleProvider         │
        └── completions (pull) ◄──┘  aggregate         │ RefProvider (@links)  │
                                                       │ LspProvider (later)   │
                                                       └───────────────────────┘
```

- **Editor** only knows the CM6 `linter()` and `CompletionSource` hooks. It
  renders whatever diagnostics/completions the facade emits.

**Diagnostics are off by default.** Squiggles in the middle of prose fight
drafting, so the whole diagnostics channel (spelling, style, and later
continuity) is **opt-in**:

- Controlled by `editor.diagnostics` in `project.json` (default `false`) and a
  quick toggle in the UI (status bar / View menu). Off = the facade suppresses
  all diagnostics; providers may still run for completions/references.
- Completions and references (the `@`/character features) are **not** affected —
  those are pull-based and only appear when asked, so they stay on.
- Later this can be per-severity or per-provider (e.g. allow a hard broken-link
  error while muting style hints), but v1 is a single global on/off, defaulting
  off.
- **`AnalysisService`** is the single facade: it holds a registry of providers,
  forwards document changes to all of them, aggregates their diagnostics, and
  merges completion results. Debounce, cancellation, and stale-result dropping
  live here — once, not per provider.
- **Providers** are the plugins. Each implements the same interface and declares
  which capabilities it offers. They can run in-renderer, in a Web Worker, or
  proxy to an external process — the facade doesn't care.

### Provider interface

```ts
interface AnalysisProvider {
  id: string
  capabilities: Array<'diagnostics' | 'completion' | 'hover'>

  // Document lifecycle (mirrors LSP didOpen/didChange/didClose)
  didOpen?(doc: Doc): void
  didChange?(doc: Doc, changes: TextChange[]): void
  didClose?(uri: string): void

  // Push: provider emits diagnostics whenever it has new results
  onDiagnostics?(cb: (uri: string, diags: Diagnostic[]) => void): void

  // Pull: editor asks for completions/hover at a position
  complete?(uri: string, pos: Position): Promise<Completion[]>
  hover?(uri: string, pos: Position): Promise<Hover | null>

  dispose?(): void
}
```

The `Doc`, `TextChange`, `Diagnostic`, `Position`, `Completion` shapes are
deliberately LSP-compatible so an `LspProvider` is a thin translation layer, not
a new model.

### Pluggability rules

- Providers register with the facade at startup (and could later come from
  project config or an extension folder).
- Adding/removing a provider **must not** touch editor or facade code.
- The facade merges results: diagnostics are the union (tagged by `provider.id`
  for filtering); completions are concatenated and de-duplicated.
- A slow or crashing provider is isolated — the facade times it out and drops its
  results rather than blocking the keystroke.

### Provider implementation language

Everything we build is **TypeScript**, running in the renderer, a Web Worker, or
the main process depending on what the provider needs (`fs`, secrets, heavy CPU).
The only non-TS case is a future external LSP server, which can be any language —
we'd only write the TS `LspProvider` adapter, not the server.

### Path to full LSP

1. **v1** — in-app providers only (spell/style/refs), most in a Web Worker.
2. **Later** — implement `LspProvider`: spawns/attaches a real language server
   (JSON-RPC over stdio via the main process), translates its
   `publishDiagnostics`/`completion` to the provider interface. Register it like
   any other provider. Editor and facade are unchanged.

## Story model & entity intelligence

The signature features — linking a character to everywhere it's mentioned,
tracking story threads — are **deterministic** "language server" features for
prose. They're the prose equivalent of _go-to-definition_ and _find-references_,
where the "symbols" are characters, threads, and locations. **No AI required**
(AI is split out — see below).

### `StoryIndex` — the project-wide model

Per-file analysis (spellcheck) isn't enough here: to know everywhere a character
appears you must have read the whole project. So we add a **`StoryIndex`** in the
main process that:

- scans all project files and extracts **entities** (characters, threads, locations),
- updates **incrementally** as files change,
- answers queries the providers use: `definitionOf(entity)`, `referencesTo(entity)`,
  `completionsAt(pos)`.

This is the prose analog of a language server's symbol table.

### Declaring entities

How an entity is declared is what keeps linking deterministic (vs. AI guessing):

- **Profile files** (most reliable) — e.g. `characters/mara.md` with frontmatter.
  The file _is_ the entity's "definition." Frontmatter carries a canonical
  `name` plus **`aliases`** — full names, nicknames, epithets (e.g. `Mara`,
  `Mara Venn`, `the courier`). Every surface form resolves to the one entity.
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
across many files. Threads are first-class entities in `StoryIndex`.

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

Threads may optionally be registered in `project.json` (display name, color) so
they render consistently; an unregistered tag still works with defaults.

**Intersecting threads (many-to-many).** A file — or a scene inside it — can
belong to _multiple_ threads at once, and threads freely overlap. `StoryIndex`
models thread membership as many-to-many, so it can also surface **intersection
points**: places where two or more threads co-occur (useful for spotting where
subplots collide or converge).

**Ordering.** A thread has an order independent of the manuscript's file order,
because a subplot's beats may be scattered:

- **Default** — manuscript order (file/scene position on disk / in the tree).
- **Explicit per-thread order** — an optional `order` value on a membership sets
  a beat's position _within that thread_, without moving the file. The same
  scene can be beat 3 of `rebellion` and beat 1 of `romance`.

  ```md
  ---
  threads:
    - { name: rebellion, order: 3 }
    - { name: romance, order: 1 }
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

## AI features (split out — deferred)

AI is deliberately **separated from the deterministic core** and deferred to
post-v1. It rides the _same_ provider/facade pipe, so nothing about the editor or
`AnalysisService` changes when it lands — an AI feature is just another provider
whose brain happens to be an LLM.

- **`ContinuityProvider`** — surfaces **conflicting behavior / continuity errors**
  ("blue eyes in ch1, brown in ch9") as `diagnostics`. This genuinely needs
  semantic understanding of prose → an LLM.
- **Thread inference** — _suggesting_ threads/links the writer hasn't tagged
  (deterministic threads stay in the core; inference is AI).

Constraints when it lands:

- Runs in the **main process** (holds the API key; renderer never sees secrets).
- Opt-in and clearly labeled; deterministic features never depend on it.
- Same `AnalysisProvider` interface — registered like any other provider.

## Phases

Delivery is grouped into phases. Each phase is independently shippable and has a
clear exit criterion; milestones (M#) are the concrete steps inside it.

> **Status (2026-07-06):** Phases 0–2 ✅ complete. **Phase 3 in progress** —
> M3 (New Project flow) ✅ and M4 (explorer file ops) ✅ done; **M5**
> (project-wide search/replace) and **M6** (drag-reorder + manuscript order)
> remain. Real file I/O over IPC backs the tree, open/save, create/rename/delete.

### Phase 0 — Scaffold ✅

Stand up the Electron shell before any features.

- Electron main + preload + Vite/React/TS renderer; app window boots.
- Secure IPC bridge in place (`contextIsolation: true`, typed `window.api`,
  renderer has no direct `fs`).
- Dev workflow: `npm run dev` (hot-reload renderer) and a production build.

**Exit:** blank window runs in dev and packaged builds; IPC round-trips a ping.

### Phase 1 — Editor validation ✅

Editor is **committed: CodeMirror 6** (see Decision history). This phase is no
longer a bake-off — it de-risks that choice and builds the seam:

- Stand up CM6 in the renderer behind the **`EditorAdapter`** interface.
- Prove **Vim mode**, one **squiggle** (decoration), and one **completion popup**
  work through the adapter.
- Confirm prose feel: soft wrap, comfortable typography, no code-gutter noise.
- **Prose Markdown styling** — style Markdown _source_ in place (headings render
  larger, strong/emphasis bold/italic, syntax marks dimmed) so it reads like
  prose while staying editable text. No colored code-editor tokens.
- **Inline notes** — `%% note to self %%` comments (Obsidian-compatible), styled
  as quiet asides, excluded from word count, and stripped on export.
- **Sample project fixture** — a real writer-gui Project checked into the repo at
  `examples/sample-project/` to open while developing and to assert against in
  tests. It exercises the core model: `project.json` (with a `threads` registry),
  manuscript files with sparse `order` + thread tags, and character profiles the
  prose mentions by name. Kept small and stable.

**Exit:** CM6 edits a markdown file from the sample project through
`EditorAdapter`, with Vim + a sample squiggle + a sample completion working.

### Phase 2 — Read & Edit (MVP) ✅

The smallest thing that's actually useful: open a project, edit a file, save it.

- **M1** ✅ — Pick a folder; detect `project.json`; render the file tree.
- **M2** ✅ — Click a file → load into CodeMirror; save with `Cmd/Ctrl+S`.

**Exit:** can open an existing project, edit a file, and save changes to disk.

### Phase 3 — Project management

Make it a real workspace, not just a viewer.

- **M3** ✅ — New Project flow (open a folder with no `project.json` → confirm →
  write a default config); `explorer.ignore` (applied in the tree read); word
  count + unsaved indicator (from Phase 2). _In-app config **editing** (settings
  form) is deferred — see Deferred decisions._
- **M4** ✅ — Explorer file ops: new file / new folder / rename / delete, via a
  tree context menu + sidebar buttons, over guarded IPC.
- **M5** — **Search**: in-document find (`Cmd/Ctrl+F`) **and** project-wide find
  & replace (`Cmd/Ctrl+Shift+F`) across all files. Quick Open + Command Palette
  are the other two surfaces and land in Phase 6 — see _Search, quick-open &
  command palette_ _(near-essential requirement)_.
- **M6** — **Reorder & manuscript order**: drag scenes in the tree; write sparse
  `order` back to frontmatter _(near-essential requirement)_.
- **Edit safety (correctness, not a feature)** — **never silently discard
  in-memory edits.** Switching away from — or closing — a file with unsaved
  changes must prompt (save / discard / cancel). This is a near-term fix for a
  data-loss gap in the current build; the fuller model (per-tab unsaved buffers
  - optional autosave) lands in Phase 6.

**Exit:** can create a project from scratch, manage and reorder its files,
search/replace across it, and never lose unsaved work by switching files.

### Phase 4 — Language intelligence

Prove the pluggable analysis path end to end.

- **M7** — `AnalysisService` facade + one provider (spellcheck) wired to CM6
  lint & autocomplete; diagnostics push, completions pull. Diagnostics **off by
  default** with a UI toggle + `editor.diagnostics` setting.

**Exit:** suggestions from a provider work; squiggles appear only when the writer
turns diagnostics on. Facade seam ready for more providers (incl. future AI and
`LspProvider`).

### Phase 5 — Story intelligence (deterministic)

The signature features, no AI.

- **M8** — `StoryIndex` scanning the project + `CharacterProvider`
  (@-mention completion, find-references, go-to-definition).
- **M9** — `ThreadProvider`: file-level + inline thread markers, intersecting
  (many-to-many) threads, per-thread ordering.
- **M10** — **Thread visualiser (read)** — braid view: lane per thread,
  intersections, ordering toggle, click-to-open.
- **M11** _(stretch / at risk)_ — **Thread visualiser (edit)** — drag to reorder
  within a thread, move / add / remove membership; writes tags back to files.
  **May be dropped**: tree-drag reordering (M6) already covers the core "move
  things around" need, and editable-braid drag is costly. Ships only if the
  read-only braid proves people want to _edit_ from it.

**Exit:** click a character → see every mention; follow a thread across chapters
in the braid. (Editing the braid is a stretch goal, not part of the exit.)

### Phase 6 — Polish & v1 · 🏁 Major Milestone

The line where writer-gui is a **"good enough" v1** — a tool a writer would use
daily. Brings the editing experience up to expectation.

- **M12** — Resizable panes, recent projects, keyboard nav in the tree.
- **M13** — **Tabs / multiple open documents.** The single-editor model becomes a
  collection (decision #4). Each open doc is its own buffer that **retains
  unsaved changes** with a per-tab dirty dot — switching tabs never writes to
  disk and never loses in-memory edits (the full form of the Phase 3 edit-safety
  fix).
- **M14** — **Autosave (opt-in).** A debounced, patch-based writer (text diffs,
  not whole-file rewrites) so it composes with external edits + undo. **Off by
  default** — explicit `Cmd/Ctrl+S` stays the predictable default (decision #5);
  the tab buffers already remove the data-loss risk, so autosave is a setting,
  not a requirement.
- **M15** — **Quick Open (`Cmd/Ctrl+P`) + Command Palette (`Cmd/Ctrl+Shift+P`)**
  on a central command registry — see _Search, quick-open & command palette_.
- Writing-experience polish (candidates): typewriter / focus mode, a word-count
  goal.

**Exit (v1):** open or create a project, draft and structure a manuscript across
tabs without losing work, find anything (in-file, across the project, by
filename, by command), and reorder scenes — all keyboard-first. **After this
point we have a good-enough app.**

> **AI features are out of scope for these phases** — see _AI features (split out
> — deferred)_. They ride the same facade and can be added later without
> reworking the phases above.

## Terminology

Plain-language definitions of terms used above.

- **Electron** — a framework for building desktop apps with web tech (HTML/CSS/JS).
  It bundles a Chrome browser + Node.js so one codebase runs as a native app.
- **Process** — a running program with its own isolated memory. Electron apps use
  more than one; they can't read each other's memory directly.
- **Main process** — the Node.js "backend" of the app. It's allowed to touch the
  filesystem, open windows, and use OS features. One per app.
- **Renderer process** — the "frontend": the window's web page (our React UI).
  For security it's sandboxed and, in our setup, **cannot** touch the filesystem
  directly.
- **IPC (Inter-Process Communication)** — how the two processes talk, since they
  can't share memory. They pass messages back and forth. Example: the UI asks
  "save this file" → main does the actual disk write → replies "done."
- **Preload** — a small trusted script that bridges renderer and main. It exposes
  a short, safe list of allowed actions (our `window.api`) so the UI can request
  things without being handed raw filesystem power.
- **`window.api`** — the object our preload puts in the UI, listing the exact
  operations the UI is allowed to ask for (open project, read file, save, etc.).
- **contextIsolation / sandbox** — Electron security settings that keep the web
  page from reaching Node/OS internals except through the preload bridge. On =
  safer.
- **CodeMirror 6** — the text-editing component we embed for the actual writing
  area (cursor, selection, syntax highlighting, squiggles).
- **CM6 lint** — CodeMirror's built-in way to display error/warning **squiggles**
  and gutter marks from a list of diagnostics we supply.
- **Autocomplete / completion / "intellisense"** — the popup of suggestions at
  the cursor (e.g. a character name). "Intellisense" is just Microsoft's brand
  name for this; we use **completion**.
- **Diagnostic** — one reported problem: a text range + severity (error/warning)
  - message. Renders as a squiggle. Spellcheck/grammar hits are diagnostics.
- **LSP (Language Server Protocol)** — a standard that lets an editor get
  intelligence (errors, completions, hovers) from a separate "language server"
  program, over a common message format. Decouples the editor from the language.
- **Language server** — the separate program in LSP that does the analysis and
  answers the editor's questions. Runs as its own process.
- **JSON-RPC** — the simple request/response message format LSP uses (JSON
  envelopes over a pipe). "RPC" = Remote Procedure Call: call a function that
  lives in another process.
- **Push vs. pull** — **push**: the analyzer volunteers results when ready (error
  squiggles appear on their own). **pull**: the editor asks on demand (completions
  when you type). We support both.
- **Facade** — a single simplified entry point that hides messier machinery
  behind it. Our `AnalysisService` is the facade the editor talks to instead of
  many analyzers.
- **Provider / plugin** — a swappable module that supplies one kind of
  intelligence (spelling, style, links). New providers register behind the facade
  without changing the editor.
- **Debounce** — waiting until typing briefly pauses before doing expensive work,
  so we don't re-analyze on every single keystroke.
- **Web Worker** — a background thread in the UI process for heavy work, so the
  editor stays responsive while analysis runs.
- **Incremental change / text patch** — sending just _what changed_ (a range +
  new text) instead of the whole file. Cheaper, and the basis for future
  auto-save.
- **TOML / JSON** — plain-text formats for config files. We use **JSON** for
  `project.json` (built into JS, no extra library); TOML is a possible later
  swap if hand-editing gets clunky.

## Deferred (post-v1)

> Tabs/multiple editors and autosave **moved into Phase 6** (M13/M14) now that
> Phase 6 is the v1 line — they're part of "good enough," not post-v1.

- **Split view** — two editors side by side. Tabs (M13) come first; a split pane
  is the additional step beyond them.
- **Config format** — revisit TOML if hand-editing `project.json` gets clunky.
- **External LSP** — an `LspProvider` that attaches a real language server over
  JSON-RPC; registers behind the same facade (see Analysis section).
- **AI features** — `ContinuityProvider` (continuity/conflict detection) and
  thread inference. Split out from the deterministic core; same facade, LLM
  brain, main-process only. See _AI features (split out — deferred)_.
- **Export / compile** — **TBD.** Get the manuscript _out_: assemble scenes in
  order into a single deliverable (`.docx` / PDF / standard manuscript format).
  A core writer need, but format, ordering source, and styling are unscoped —
  design later. **Contract already fixed:** export must (1) **strip `@{…}` mention
  wrappers**, leaving the surface text (`@{the courier}` → "the courier"), and
  (2) **remove `%% … %%` note comments** entirely, so the output is clean prose.

## Deferred decisions (revisit later)

Open questions we've deliberately postponed — distinct from _Deferred (post-v1)_
(features we'll build later) and _Decision history_ (choices already settled).
Each records what we're doing **now** and the trigger to **revisit**. Newest at
the bottom. (Raised 2026-07-06.)

- **Config format & external-edit deterrence.** _Now:_ plain, human-readable
  `project.json` (decision #3), editable outside the app. Considered renaming to
  a custom/branded extension to discourage hand-editing, but that only adds
  friction (it's still JSON) and fights the no-lock-in goal. _Revisit when:_
  project metadata outgrows a single config file, or app-managed state (caches,
  index) needs somewhere to live — at which point a hidden **`.writer/`
  dotfolder** (like `.git/`, `.vscode/`) is the idiomatic move, keeping files
  plain while signalling "app-managed." A custom binary/proprietary format stays
  off the table.
- **In-app config editing (settings UI).** _Now:_ `project.json` is created by
  the New Project flow (M3) and otherwise edited outside the app; it isn't
  editable in the Markdown editor (decision #17). _Revisit:_ early in Phase 3 —
  a small settings **form** (name, word-wrap, diagnostics default, ignore list,
  thread registry) that reads/writes the config while **preserving unknown
  keys**. This is the intended answer to "how do I edit config in-app," not
  raw-JSON editing.
- **Plain-text editing of non-Markdown files.** _Now:_ Markdown-only editing;
  other files show greyed/non-selectable in the tree (decision #17). _Revisit
  when:_ users need to edit adjacent plain-text files (`.txt`, config, notes)
  in-app — would add a stripped-down non-prose editor mode and supersede #17.
- **Image display.** _Now:_ images are non-`.md`, so they show greyed and aren't
  viewable. _Revisit:_ two features — (a) a **solo** read-only image viewer in
  the main pane (fits #17's "read-only" allowance; small), and (b) **inline**
  rendering of `![](…)` inside Markdown (a CodeMirror widget; larger). Both would
  share one mechanism: a **guarded custom protocol** (e.g. `writer-file://`) in
  main that serves only files under the open project root — avoids base64 bloat
  and preserves the sandbox. Likely Phase 6 polish, or on demand.
- **Manuscript-order scope.** _Now:_ `order` sequences files **within their
  directory**; folders sort alphabetically (dirs-first) and aren't themselves
  orderable. _Revisit when:_ projects want a single **global** reading order
  across folders, or want to **order folders** (e.g. parts/acts) — needs a place
  to store folder order (folders have no frontmatter), likely `project.json` or a
  per-folder marker.
- **Desktop shell (Electron vs. Tauri).** _Now:_ staying on Electron; the
  renderer is kept shell-agnostic behind `window.api` (decision #24) so a swap is
  cheap. _Revisit:_ **before Phase 5** — migration cost rises as main-process
  logic accumulates (`StoryIndex`, a future LSP subprocess), so decide before
  that lands, not after. Tauri's tax is rewriting main in Rust + webview
  inconsistency.

## Decision history

A running log of the choices behind this spec and _why_, so future changes don't
re-litigate settled ground. Newest at the bottom. (All dated 2026-07-05, the
initial design conversation.)

1. **Product shape** — Electron desktop app: file explorer on the left, editor on
   the right. _Why:_ familiar, trusted layout for a writing tool.
2. **A "Project" is a folder with a marker file** — the app treats a directory as
   a Project when a marker config sits at its root. _Why:_ plain files on disk,
   no database, no lock-in.
3. **Config format: JSON (`project.json`), not TOML** — _Why:_ native to JS, zero
   dependency, leaner to start. TOML kept as a possible later swap if
   hand-editing gets clunky.
4. **Single active editor in v1**, but modeled as a collection-of-one. _Why:_
   simplest useful thing now; split view / tabs stays additive, not a rewrite.
5. **Explicit save only (`Cmd/Ctrl+S`)** — _Why:_ predictable. Auto-save deferred
   and, when built, should be patch/diff-based.
6. **Explorer file ops in v1** — new file, new folder, rename, delete. _Why:_ it's
   a workspace, not just a viewer.
7. **Analysis is a pluggable provider/facade (LSP-shaped)** — the editor talks to
   one `AnalysisService`; intelligence is swappable providers. _Why:_ keeps the
   editor dumb and lets a real external LSP drop in later unchanged.
8. **Providers are TypeScript** (renderer / Web Worker / main as needed). Only a
   future external LSP server could be another language, reached via a TS adapter.
9. **Story features are deterministic, not AI** — character linking (find-refs,
   go-to-definition) and threads run off a project-wide `StoryIndex`. _Why:_ these
   are the differentiator and don't need an LLM to be reliable.
10. **Threads: file-level + inline markers, many-to-many, per-thread ordering.**
    A scene can sit on multiple threads; each thread can order its beats
    independently of manuscript order.
11. **Thread visualiser is editable (two-way)** — a braid view where dragging
    reorders beats / changes membership and **writes tags back to the files**.
    _Why:_ also resolved decision #10's ordering — you drag instead of
    hand-typing order numbers.
12. **AI is split out and deferred** — continuity/conflict detection and thread
    _inference_ ride the same facade later, main-process only, opt-in. _Why:_ keep
    the deterministic core independent of any LLM.
13. **Diagnostics (squiggles) off by default**, with a toggle. _Why (writer
    feedback):_ squiggles fight drafting; prose isn't correct/incorrect. Pull
    features (completions/references) stay on.
14. **Export/compile acknowledged as a core need — TBD.** _Why:_ a writer must be
    able to get the manuscript out; scoped later (see Deferred).
15. **Editor: committed to CodeMirror 6.** Evaluated TipTap / Lexical (prose-model,
    built-in `@mention`, WYSIWYG) vs. CM6 / Monaco (text-model). _Why CM6:_
    keyboard-first product stance + real **Vim mode**, which prose-model editors
    lack; Monaco excluded as too IDE-feeling. Trade-off accepted: hand-roll the
    `@mention` UI on CM's completion API, and edit visible Markdown source rather
    than WYSIWYG.
16. **`EditorAdapter` seam added** so #15 stays reversible. _Why:_ switching within
    text-model editors is a few days; the only expensive move is crossing to a
    WYSIWYG document model (content re-serialization + losing Vim) — which the
    keyboard-first stance makes unlikely anyway. Markdown text is the canonical
    in-memory representation to keep the on-disk contract editor-independent.
17. **Scope: Markdown (`.md`) only in v1.** Editor, analysis, and story features
    target Markdown; other file types are out of scope (may show in the tree but
    aren't edited). _Why:_ one format keeps parsing, frontmatter, and the story
    model simple; prose is Markdown anyway.
18. **Near-essential requirements added: project-wide search/replace and
    scene reordering + manuscript order.** _Why:_ a writer would notice both
    missing on day one — finding/renaming across the book, and structuring scene
    order. Manuscript order is stored as sparse frontmatter `order`, edited by
    tree drag.
19. **Thread-visualiser _editing_ downgraded from requirement to stretch/at-risk.**
    _Why:_ tree-drag reordering (#18) already covers rearranging structure, so an
    editable braid is no longer load-bearing. The read-only braid stays a
    committed feature; drag-to-edit ships only if demand shows up. Trade
    considered: CodeMirror fully supports the prose **typography** goals (font,
    measure, line height, soft wrap, themes, focus-dimming via decorations;
    typewriter scrolling via a small custom extension), so the writing-experience
    bar isn't what's at risk — the braid-editing complexity is.
20. **Phase 1 built; `EditorAdapter` interface refined from the sketch.** CM6 is
    mounted behind the seam with Vim, prose typography (centered measure, serif,
    no gutter), a demo squiggle (crutch-word linter), and `@`-mention completion
    — all through the adapter, loading the sample-project fixture. Refinements vs.
    the original sketch: added `mount()`; `onChange` yields the new text and
    returns an unsubscribe fn; completions are a registered **`CompletionSource`**
    (pull) rather than a pushed `showCompletions` list — matching how editors and
    the future AnalysisService actually work. _Why:_ keep the seam faithful to
    real editor + analysis mechanics.
21. **Mentions use `@{surface}` (braced); names carry aliases; Markdown styled in
    source.** _Why:_ braces let a mention span multiple words and be stripped on
    export, so plain `@word` (space-terminated) isn't a limit; a character's
    canonical `name` + `aliases` all resolve to one entity, so full names and
    nicknames link too (plain-name detection is the natural prose path, `@{…}`
    the explicit one). Also: Markdown source is styled in place (big headings,
    real bold/italic, dimmed marks) for prose feel without leaving source mode.
22. **Inline notes via `%% … %%` (Obsidian-compatible).** Notes-to-self live in
    the source as dimmed asides, are excluded from word count, and are stripped
    on export. _Why:_ fits the plain-files, strip-on-export model (like `@{…}`) —
    no sidecar store. Margin/anchored (Google-Docs-style) comments considered but
    deferred as heavier (needs range-anchoring + a separate store).
23. **Phase 2 built; IPC contract, shared types, and a path guard added.** Real
    file I/O replaces the `?raw` sample import. Refinements vs. the Process/IPC
    sketch: `openProject()` bundles the folder dialog + config read into one call
    returning a **discriminated result** (`ok` / `cancelled` / `no-config` /
    `invalid-config`) instead of throwing across IPC; `readTree()` takes no
    argument and reads the main-held current project root rather than trusting a
    renderer-supplied path. IPC domain types (`ProjectMeta`, `TreeNode`,
    `ProjectConfig`, result unions) live in **`src/shared/`** (aliased `@shared`
    in the renderer) so main, preload, and renderer share one definition. Main
    keeps the open project's root and **guards every file op** so a renderer
    can't read/write outside it. Save is explicit `Cmd/Ctrl+S` via a
    renderer-level key listener (no editor-seam change); dirty state is derived
    by comparing live editor text to the last-saved baseline. Non-`.md` files
    show in the tree but are greyed/non-selectable (decision #17). _Why:_ keep
    the renderer untrusted and the seam intact while making failures data, not
    exceptions.
24. **`window.api` is a formal desktop-shell seam (Electron kept replaceable).**
    Electron isn't going away, but the renderer is deliberately shell-agnostic:
    it talks only to typed `window.api` methods, never to Electron/Node/`fs`/
    `ipcRenderer`; all shell code lives in `src/main` + `src/preload`; IPC
    payload types live in `src/shared` free of shell types. _Why:_ a future
    shell swap (e.g. Tauri, for smaller bundle/RAM) should touch only
    `src/main`/`src/preload`, leaving `src/renderer` intact. Decision now: **stay
    on Electron**; the cost of switching rises as main-process logic accumulates
    (Phase 5 `StoryIndex`, a future LSP subprocess), so reassess before Phase 5,
    not after. Recorded as a standard in AGENTS.md → _Keep seams intact_.
25. **Manuscript-order requirements pinned down (ahead of M6).** `order` lives in
    per-file frontmatter (sparse, step 10), scopes files **within a directory**,
    and is edited only by **drag** — dropping between siblings rewrites just that
    file's `order` (midpoint / `last + 10`), never moving the file on disk;
    dropping onto a folder is a **move** (`rename`) that carries `order` along.
    Write-back is non-destructive (only the `order` field changes); the `NN-`
    filename prefix is cosmetic and may diverge from `order`. Renormalize a
    folder only when a gap runs out. _Why:_ make M6 unambiguous and keep the
    single-file-write property that motivated sparse ordering (#18). Global
    cross-folder ordering and orderable folders are deferred (see _Deferred
    decisions_).
26. **Edit safety + save model settled.** Explicit `Cmd/Ctrl+S` stays the default
    (decision #5). _Near-term (Phase 3):_ switching or closing a file with unsaved
    changes **prompts** — never silently discards edits (fixes a data-loss gap in
    the current build). _Full model (Phase 6, M13/M14):_ **tabs** where each open
    doc is its own buffer that **retains** unsaved changes (per-tab dirty dot), so
    switching never writes and never loses work; **autosave** becomes an **opt-in**
    setting, patch-based, not the default. _Why:_ writers want control, predictable
    saves, and git-friendliness; per-tab buffers remove the data-loss risk without
    forcing autosave-to-disk.
27. **Phase 6 = the v1 "good enough" Major Milestone; search fleshed out
    VS-Code-style.** Search is four keyboard surfaces: in-document find
    (`Cmd/Ctrl+F`) + project-wide find/replace (`Cmd/Ctrl+Shift+F`) in **M5**;
    Quick Open fuzzy file finder (`Cmd/Ctrl+P`) + Command Palette
    (`Cmd/Ctrl+Shift+P`) in **Phase 6**, both on a central **command registry**
    that menus and keybindings also consume (a pluggability seam like
    `AnalysisService`). Tabs + autosave moved from _Deferred_ into Phase 6.
    _Why:_ palette + quick-open are the keyboard-first payoff that matches the
    product stance; the registry keeps commands/keybindings in one place; and
    Phase 6 is the natural line past which the app is usable daily.
