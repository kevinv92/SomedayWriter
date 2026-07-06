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
    "diagnostics": false,
    "measure": 46,
    "font": "serif",
    "fontSize": 16,
    "lineHeight": 1.7
  },
  "explorer": {
    "ignore": [".git", "node_modules", "*.tmp"]
  }
}
```

- `project.name` is required; everything else has defaults.
- Unknown keys are preserved on save (don't clobber fields the app doesn't know).
- `editor.measure` — the editor text-column width ("measure") in **rem**
  (default `46`), or `"full"` to fill the pane. Deliberately fixed and centered
  for prose readability; widening the window doesn't stretch the text.
- **Editor typography** — `editor.font` (a preset `serif` | `sans` | `mono`, **or
  any CSS font-family string** naming a font installed on the system, e.g.
  `"GT Sectra, Georgia, serif"`), `editor.fontSize` (px, default 16), and
  `editor.lineHeight` (unitless, default 1.7). Applied via CSS variables on the
  editor pane — no editor rebuild.
- **Custom / paid fonts.** An **installed** font works today (just name it in
  `editor.font`). Loading a font **file** that isn't installed — or one that
  should travel with the project — needs an `@font-face` served through the
  guarded `writer-file://` protocol (the same one proposed for images); a future
  `editor.fontFile` setting. The app **never bundles or ships fonts** — it only
  points at fonts the user already has; committing a paid font file into a shared
  project is the user's licensing call.
- The above are wired now but require hand-editing `project.json`; a **settings
  UI** and a **global default with per-project override** land in Phase 6
  (decision #28).

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

## File titles (derived, not duplicated)

A scene/chapter's display **title** — shown in the binder/tree, the thread
visualiser's nodes, the inspector, and export — is **derived**, not required in
frontmatter. Otherwise the same name is declared three times (filename +
frontmatter `title` + `#` heading) and the copies drift apart.

Resolution order (first hit wins):

1. **`frontmatter.title`** — an explicit override, for when the display title
   must differ from the heading, or the file has no `#` heading.
2. **The first `#` (H1) heading** in the body — the natural source; it's already
   visible in the prose.
3. **The filename** — prettified (strip the `NN-` order prefix and `.md`,
   title-case) as a last resort.

So a normal file declares **no** `title`; it just has `# Arrival`. Frontmatter
`title` stays available for the override case. `StoryIndex` computes the title
(Phase 5) so every consumer agrees on one value.

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
- **Go to Entity — `#` prefix in Quick Open** _(Phase 6, needs Phase 5)._ The
  prose analog of "go to symbol": fuzzy-search **entities** (characters, threads,
  locations) from `StoryIndex` and jump to the selected one's definition (its
  profile file) — the same go-to-definition `CharacterProvider` exposes. It's a
  **mode of the same widget** (like `>` for commands), not a separate shortcut,
  so there's one thing to learn. Powered by `StoryIndex` (Phase 5), which lands
  before Quick Open (Phase 6), so entity mode can ship with the widget. A
  dedicated entity browser/panel stays a later option if `#` mode proves too
  cramped.

**Command registry (the seam behind the palette).** Commands are declared once in
a central registry — `{ id, title, keybinding?, run() }` — and **every** trigger
draws from it: the palette, any menus, and keyboard shortcuts. Adding a command
must not touch palette or menu code (same pluggability stance as
`AnalysisService`), and keybindings get a single source of truth. **Fuzzy
matching** is a small subsequence scorer over filenames / command titles — no
heavy dependency.

## App settings (global) vs project config

Two tiers of configuration, stored **separately**:

- **Project config — `project.json`** (per project, in the folder). Describes the
  _project_: name, `explorer.ignore`, thread registry, and per-project editor
  defaults (`wordWrap`, `diagnostics`, `defaultExtension`). Travels with the
  folder; lives in the writer's repo.
- **App settings — `settings.json`** in the OS user-data dir
  (`app.getPath('userData')`, e.g. `~/Library/Application Support/writer-gui/`).
  Describes the _app / user_, independent of any project: **recent projects**
  (paths + last-opened), the project to reopen on launch, window bounds, and
  global editor preferences (e.g. Vim default, theme). **Never** inside a project
  folder.

Rules:

- **Main owns both**; the renderer reaches them only through typed `window.api`
  (`getSettings()` / `updateSettings(patch)`), never touching `fs` — same stance
  as the project methods.
- **Precedence** — where a setting exists in both tiers, the **project value wins**
  for that project (e.g. a project can force `diagnostics` on); app settings are
  the default when the project doesn't specify.
- **Plain JSON, zero-dep** (decision #3) — no `electron-store`; `settings.json` is
  read/written with native `JSON`, unknown keys preserved.
- **Introduced in Phase 6** with recent projects (M12); nothing before then needs
  global storage.

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

## Inspector (file details) pane

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
- **AI writing assistant (chat panel)** — a conversational **side pane** (like an
  IDE chat), another pane in the multi-pane shell. Its differentiator: it's
  **grounded in the deterministic model** — it pulls context from `StoryIndex`
  (the current scene, the selection, relevant character profiles, a thread's
  beats) and can call the prose "language server" as **tools** (find-references,
  a character's mentions, manuscript order), so answers are anchored in the real
  project rather than guessed. Streams responses; can propose edits the writer
  applies. Unlike the other two, it's a **separate surface**, not an
  `AnalysisProvider` (chat, not diagnostics) — but it shares the same AI rules
  below. Claude is the natural default model; provider-flexible.

Constraints when it lands:

- Runs in the **main process** (holds the API key; renderer never sees secrets).
- Opt-in and clearly labeled; deterministic features never depend on it.
- Diagnostics/inference use the same `AnalysisProvider` interface; the chat
  assistant is a separate pane but obeys the same key/opt-in/independence rules.
- Post-v1, its own later **AI phase** — after the deterministic phases (5–9).

### Model access & billing (two paths)

How the LLM is reached — and, critically, how it's **billed** — has two shapes:

- **In-app chat panel** — writer-gui embeds the client, so it needs model access
  via the **Anthropic API (metered)** or, better, **bring-your-own-key**. A Claude
  **Pro/Max subscription cannot be used here**: subscription OAuth is for
  Anthropic's **first-party** clients (Claude Code, Claude Desktop, the official
  VS Code extension), not third-party apps. writer-gui **never ships its own key.**
- **writer-gui as an MCP server** _(the subscription-friendly path, recommended)_
  — expose the project + the deterministic prose tools (`StoryIndex`:
  find-references, character mentions, manuscript order; file read/search) as an
  **MCP server**. Drive it from a client that already carries your subscription
  auth — **Claude Code / Claude Desktop / the Claude VS Code extension** — so the
  LLM calls run on **your subscription, no API charges**, while writer-gui
  supplies the grounding. This also makes the "grounded in the real project"
  differentiator reusable by _any_ MCP client, not just an in-app panel.

Net: the embedded panel is the BYO-key convenience; the **MCP-server** path is how
a subscriber uses AI over their manuscript without metered API cost — and it's the
more on-brand shape (the prose "language server" exposed as tools).

## Phases

Delivery is grouped into phases. Each phase is independently shippable and has a
clear exit criterion; milestones (M#) are the concrete steps inside it.

> **Status (2026-07-06):** Phases 0–4 ✅ complete. **Next: Phase 5** (story
> intelligence — `StoryIndex` + `CharacterProvider`/`ThreadProvider`). Phase 4
> shipped the `AnalysisService` facade + provider registry wired through the
> `EditorAdapter`: a spell provider (diagnostics, off by default) and a mention
> provider (completion). Phase 3 shipped New Project, explorer file ops,
> in-document + project-wide search/replace, drag reorder/move with sparse
> frontmatter `order`, and the edit-safety guard.

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

### Phase 3 — Project management ✅

Make it a real workspace, not just a viewer.

- **M3** ✅ — New Project flow (open a folder with no `project.json` → confirm →
  write a default config); `explorer.ignore` (applied in the tree read); word
  count + unsaved indicator (from Phase 2). _In-app config **editing** (settings
  form) is deferred — see Deferred decisions._
- **M4** ✅ — Explorer file ops: new file / new folder / rename / delete, via a
  tree context menu + sidebar buttons, over guarded IPC.
- **M5** ✅ — **Search**: in-document find (`Cmd/Ctrl+F`, via CodeMirror's search
  extension through the adapter) **and** project-wide find & replace
  (`Cmd/Ctrl+Shift+F`) — a main-process scan of all `.md` files, results grouped
  by file, click-to-open at the match line, plain-substring replace-all. Quick
  Open + Command Palette are the other two surfaces and land in Phase 6 — see
  _Search, quick-open & command palette_ _(near-essential requirement)_.
- **M6** ✅ — **Reorder & manuscript order**: files sort by frontmatter `order`;
  drag a scene onto another to reorder (sparse midpoint write, renormalize only
  when a gap runs out) or onto a folder to move; `order` written non-destructively
  _(near-essential requirement)_.
- **Edit safety** ✅ — switching away from a file with unsaved changes prompts
  (save / discard / cancel); never silently discards edits. The fuller model
  (per-tab unsaved buffers + optional autosave) lands in Phase 6.

**Exit:** can create a project from scratch, manage and reorder its files,
search/replace across it, and never lose unsaved work by switching files.

### Phase 4 — Language intelligence ✅

Prove the pluggable analysis path end to end.

- **M7** ✅ — `AnalysisService` facade + provider registry, wired to CM6 lint &
  autocomplete **through the `EditorAdapter`** (the app/facade never import CM).
  Diagnostics **push**, completions **pull**; debounce + the on/off gate live in
  the facade. Diagnostics **off by default** (UI toggle + `editor.diagnostics`).
  Two providers ship: a **spell provider** (diagnostics — common misspellings +
  repeated words; dictionary-free so false positives are near-zero) and a
  **mention provider** (completion — the `@`-mention demo, moved behind the
  facade; Phase 5 swaps in a StoryIndex-backed `CharacterProvider`).

**Exit:** suggestions from a provider work; squiggles appear only when the writer
turns diagnostics on. Facade seam ready for more providers (incl. future AI and
`LspProvider`).

### Phase 5 — Story intelligence (deterministic)

The signature features, no AI.

- **M8** — `StoryIndex` scanning the project + `CharacterProvider`
  (@-mention completion, find-references, go-to-definition). Includes the full
  YAML frontmatter parse (deferred from M6) and the derived **title** (see _File
  titles_).
- **M8b** — **Inspector (file details) pane** — a read-only mirror of what
  `StoryIndex` parsed for the current file (title source, order, threads,
  mentions, parse warnings). See _Inspector (file details) pane_.
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

### Phase 6 — Writing environment · 🏁 v1 Major Milestone

The **"good enough" v1** — the point writer-gui becomes a comfortable daily
writing environment: multiple documents, safe editing, fast navigation, and one
coherent search. **Scoped to the milestones below** — not an open-ended polish
bucket.

- **M12** — Resizable panes, recent projects, keyboard nav in the tree.
  Introduces the **app-settings store** (`settings.json` in user-data) that backs
  recent projects + global prefs — see _App settings (global) vs project config_.
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
- **M16** — **Unify the search UI.** The in-file find (`Cmd/Ctrl+F`, CodeMirror's
  native widget) and the project-wide panel currently look like two unrelated
  UIs. Bring them into **one visual language** — matching inputs, buttons,
  accent, and match highlighting — so scope (this file vs. the project) is the
  only difference the writer perceives, not the styling. Options: heavily theme
  CM's find panel to match, or replace it with a custom in-file widget sharing
  the project panel's components.

**Exit (v1):** open or create a project, draft and structure a manuscript across
tabs without losing work, find anything (in-file, across the project, by
filename, by command), and reorder scenes — all keyboard-first. **After this
point we have a good-enough app.**

### Phase 7 — Extended entities (worldbuilding)

Generalize the story model beyond characters and threads to **any entity type**,
so worldbuilding — locations, items, factions, magic systems — links exactly the
way characters do. Post-v1, and the deterministic core only: entities as
referenceable pages. (Enforcing a magic system's _rules_ against the prose is
semantic and belongs to the AI `ContinuityProvider` — see _AI features_.)

- **M17** — **Type-generic `EntityProvider`.** Refactor Phase 5's
  `CharacterProvider` into one provider parameterized by `type` (already the
  discriminator in profile frontmatter). Profile files of any `type` —
  `location`, `item`, `faction` / `organization`, `magic-system`, `artifact` —
  get the same `@`-mention completion, find-references, go-to-definition, plus
  **`name` + `aliases`** resolution off `StoryIndex`, with **no per-type code**.
  Unknown types work with defaults.
- **M18** — **Registered entity types** in `project.json` (like the threads
  registry): display name, icon, colour — so the tree, inspector, and visualiser
  can badge a location vs. an item.

**Exit:** `@{Redhill}` resolves to the location page whose canonical name is
"Giant's Rest" (via aliases), just like a character; every entity type shares one
code path.

### Phase 8 — Editorial marks (comments & revisions)

Post-v1 editorial layer, plain-text via CriticMarkup — see _Comments & editorial
marks_. Reuses the decoration + hover-tooltip machinery already in the editor.

- **M19** — **Anchored comments.** `{>>…<<}` (at a point) and
  `{==span==}{>>…<<}` (attached to a span), rendered as a highlight + hover
  tooltip, edit-in-source; stripped on export. Reuses the `%%`-notes decoration
  pattern.
- **M20** _(optional)_ — **Comments panel** — a per-file list of comments
  (click-to-jump), surfaced through the inspector / analysis facade.
- **M21** _(stretch)_ — **Suggested edits / tracked changes** — CriticMarkup
  insert / delete / substitute marks, accepted or rejected on export.

**Exit:** highlight a sentence, attach a private comment that survives editing
around it, and confirm it never reaches the exported prose.

### Phase 9 — External analysis providers (opt-in)

Bring third-party grammar/style engines in as providers behind the existing
`AnalysisService` facade — **no editor or facade change** (this is exactly what
the pluggable design was for).

- **M22** — A **main-process provider** that calls an external checker's API,
  maps results → `Diagnostic[]`, and emits through the facade. First targets:
  **LanguageTool** (open-source, **self-hostable** so prose can stay on-device;
  or cloud) and **ProWritingAid** (developer API). _Grammarly has no third-party
  editor API, so it's out._
- **M23** _(optional)_ — **`LspProvider`**: attach a real language server over
  JSON-RPC (e.g. `ltex-ls` for LanguageTool) — the deferred-LSP path realized.

Rules: **opt-in, off by default** (the diagnostics toggle); the **API key lives
in main** (the renderer never sees it); sending prose to a cloud service is
**disclosed** (self-hosted LanguageTool avoids it entirely). Ships **named**
integrations — a full user-installable plugin SDK (arbitrary sandboxed
third-party providers) is a bigger, separate _Deferred_ item.

**Exit:** enable LanguageTool; its grammar/style hits appear as squiggles through
the same facade as the built-in spell provider, opt-in.

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
- **Writing-experience polish** — typewriter / focus mode, word-count goals.
  (Dropped from Phase 6 to keep it scoped; nice-to-haves, not part of v1.)
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
  wrappers**, leaving the surface text (`@{the courier}` → "the courier"),
  (2) **remove `%% … %%` note comments** entirely, and (3) **strip CriticMarkup**
  — remove `{>> … <<}` comments and unwrap `{==span==}` highlights to their text —
  so the output is clean prose.

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
28. **Two-tier config: app settings vs project config.** Per-project settings stay
    in `project.json` (in the folder, in the repo); **app/user** settings — recent
    projects, reopen-on-launch, window bounds, global editor prefs — live in a
    separate `settings.json` in the OS user-data dir (`app.getPath('userData')`),
    never inside a project. Main owns both; the renderer uses typed
    `getSettings`/`updateSettings`; project values override app defaults where
    they overlap; plain JSON, zero-dep (no `electron-store`). Introduced in Phase 6
    (M12, recent projects). _Why:_ recent projects and global prefs are inherently
    not project-scoped and must persist across projects and launches.
29. **Phase 4 built; analysis facade + a dictionary-free spell provider.** The
    `AnalysisService` (renderer) holds the provider registry, debounces, gates
    diagnostics on/off, and merges completions; the editor reaches it only
    through the existing `setDiagnostics`/`setCompletionSource` adapter methods,
    so the CM-only rule holds. The Phase 1 demo wiring is gone: `@`-mentions moved
    into a `mention` **provider**, and the crutch-word demo was replaced by a
    `spell` **provider** (common-misspellings map + repeated-word detection).
    _Why the lightweight spell check:_ a real Hunspell dictionary is ~1MB and
    Phase 4 is about proving the pluggable path, not shipping a dictionary — and
    a full `nspell`-in-main provider can register alongside later with **zero**
    facade changes (exactly the payoff of the design). Provider positions use
    **offsets**, not LSP line/char, matching the editor seam (refines the sketch,
    cf. #20).
30. **File titles are derived, not duplicated.** A file's display title resolves
    `frontmatter.title` → first `#` heading → prettified filename; a normal file
    declares no `title` (it just has the heading). _Why:_ declaring it in
    frontmatter as well duplicates the name three ways (filename + frontmatter +
    heading) and the copies drift. `StoryIndex` computes the one title so every
    consumer (tree, visualiser, inspector, export) agrees. Sample fixture
    de-duplicated to match.
31. **Inspector (file-details) pane — specced now, built with Phase 5 (M8b).** A
    togglable read-only pane mirroring what `StoryIndex` parsed for the current
    file (title source, order, threads, mentions, and — the point — frontmatter
    parse warnings), as a debugging aid for hand-edited frontmatter. _Why Phase 5:_
    it must read the same parsed model the app uses (never parse independently),
    and that model + full YAML frontmatter parsing arrive with `StoryIndex`.
    Confirms the shell is a multi-pane system (tree / editor / project-search /
    inspector / visualiser), with a resizable layout deferred to M12.
32. **Phase 6 rescoped from "Polish" to "Writing environment".** "Polish" read as
    an open-ended bucket; Phase 6 is now scoped to the concrete milestones already
    in it (tabs, autosave, quick-open + palette, unified search, panes / recent
    projects / keyboard nav + app-settings). Still the 🏁 v1 Major Milestone.
    Speculative writing-experience extras (typewriter / focus mode, word-count
    goals) moved to _Deferred (post-v1)_. _Why:_ a named, bounded phase is
    schedulable; a polish grab-bag isn't.
33. **Entity model is type-generic; extended types are Phase 7.** An entity is any
    profile file with a `type` (the discriminator already in the fixture). One
    `EntityProvider` parameterized by `type` links characters, locations, items,
    factions, magic systems… with `name` + `aliases` resolution and no per-type
    code. **v1 (Phase 5) ships `character` + threads**; the generic provider and
    more types land in **Phase 7**. Worldbuilding entities are referenceable pages
    (deterministic); enforcing a magic system's _rules_ against the prose is
    semantic and stays in the AI `ContinuityProvider` lane (deferred). _Why:_ the
    linking machinery was always entity-agnostic — hard-coding one provider per
    type would be needless duplication.
34. **Manuscript hierarchy = a folder-tree of units (scene → chapter → act);
    captured now, mostly deferred.** A unit is a file (leaf) or folder
    (container); nesting is general, not a fixed three levels; sequencing is
    depth-first + per-directory `order` (already built). **Level is implicit from
    tree depth**, with an optional per-file `level` override and a **folder marker
    file** (`index.md` or `_folder.md`) for folder-level metadata + child defaults
    — both **reserved, not implemented**; they only become load-bearing at
    export/compile. _Why capture now:_ so export, the binder, and the visualiser
    build on one agreed model without a rewrite, without over-building before it's
    needed. Marker file stays an explicit declaration (identity remains
    frontmatter-driven, not folder-name-driven — cf. the affirmed principle).
35. **Anchored comments via CriticMarkup (Phase 8) — resolves the deferred half of
    #22.** Comments attach to a span with CriticMarkup
    (`{==span==}{>>note<<}`), so they live inline in the `.md` (no sidecar store)
    and CodeMirror anchors them **for free** as the text shifts. Rendered with a
    decoration + `hoverTooltip` — the same toolbox as the lint squiggles. `%%…%%`
    stays the _unanchored_ note; `{>>…<<}` is the _anchored_ comment; both strip on
    export (the contract now also unwraps `{==…==}` highlights). Google-Docs
    margin/threads stays a possible later _display_ layer, not the foundation.
    CriticMarkup also opens a future tracked-changes lane (M21). _Why:_ inline
    marks dodge the anchor-drift + separate-store cost that made #22 defer this,
    and reuse decoration machinery the editor already has.
36. **External grammar/style tools plug in as providers (Phase 9, opt-in).** They
    ride the existing `AnalysisService` facade — a main-process provider calling
    the tool's API (or an `LspProvider`), mapping results → diagnostics, off by
    default, key in main, cloud use disclosed. First targets **LanguageTool**
    (open, self-hostable) and **ProWritingAid** (API); **Grammarly is out** — no
    third-party editor API. Ships _named_ integrations; a sandboxed user-plugin
    SDK is a bigger Deferred item. _Why:_ this is precisely what the pluggable
    analysis design was for — no editor/facade change.
37. **AI writing assistant (chat panel) — a separate AI surface, grounded in the
    model.** A conversational side pane, post-v1, its own later AI phase. Unlike
    `ContinuityProvider`/inference it is **not** an `AnalysisProvider` (chat, not
    diagnostics), but obeys the same rules (main-process key, opt-in, deterministic
    core independent). Its edge: context + **tools** from `StoryIndex`
    (find-references, mentions, order) so it reasons over the real structured
    project. Claude is the default model, provider-flexible. _Why:_ the deterministic
    prose "language server" is exactly the grounding a generic chatbot lacks.
38. **AI model access: BYO-key panel vs. MCP-server (subscription-friendly).** A
    third-party app can't ride a user's Claude Pro/Max subscription — that OAuth is
    for Anthropic first-party clients (Claude Code/Desktop/official extension). So
    the **in-app chat** needs the metered API / bring-your-own-key (we never ship a
    key), while the **subscription-cost-free** path is exposing writer-gui as an
    **MCP server** (project + `StoryIndex` tools) driven from a subscription-authed
    client (Claude Code/Desktop). _Why:_ MCP sidesteps API billing _and_ makes the
    grounded-in-the-model differentiator reusable by any MCP client — the more
    on-brand shape than an embedded panel.
