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
    "lineHeight": 1.7,
    "autosave": false
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
  click-to-open at the match; replace across matches. Runs in **main** (it reads
  every file) behind a typed `window.api` method. _v1 ships **replace-all** for
  the query (plain substring, case toggle); **per-match selection** and **regex**
  across the project are refinements (in-document find already has regex)._
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
a central registry — `{ id, title, category, defaultKeybinding?, run() }` — and
**every** trigger draws from it: the palette, keyboard shortcuts, and the native
menu. Adding a command must not touch palette or menu code (same pluggability
stance as `AnalysisService`). One source of truth, three consumers:

- **Palette / shortcuts** — the renderer reads the registry directly (M15 today
  has an ad-hoc `commands` array; it becomes the registry).
- **Native menu — generated from the registry, not hand-maintained.** The
  renderer hands main the menu-relevant commands (id, label, effective
  keybinding, group) over IPC; main renders them as an Electron `Menu`. That menu
  builder is the **only shell-specific piece** — the registry and the dispatch
  stay in the renderer, so a shell swap (Tauri) rewrites just the builder, not the
  commands (reinforces decision #24, the `window.api` seam). Menu items use
  `registerAccelerator: false` so the shown shortcut doesn't hijack the key from
  the renderer / CodeMirror.
- **User-overridable keybindings.** A **`keybindings.json`** in the app-settings
  user-data dir remaps any command (the VS Code model); the registry merges
  `defaultKeybinding` + user overrides into the **effective** binding that the
  palette shows and the menu displays. Editor-owned keys (CM's `⌘Z`, `⌘F`) are
  documented as reserved.

**Fuzzy matching** is a small subsequence scorer over filenames / command titles
— no heavy dependency.

**Status:** the palette + shortcuts exist (M15 + keyboard nav); the **unified
registry, the generated native menu, and user keybinding overrides are not built
yet** — a `menu.ts` first cut exists but should be driven by the registry rather
than a parallel hardcoded list.

## Keyboard navigation & focus

Keyboard-first, and **prefer OS/platform-standard shortcuts** so muscle memory
transfers. They differ per OS (⌘ on macOS, Ctrl on Windows/Linux — and some, like
tab switching, differ beyond the modifier), so shortcuts are delivered by **two
layers**, not hardcoded:

- **Native application menu (Electron `role`s)** — the truly-standard OS actions
  come from a real menu built with Electron **roles**, which supply the correct
  **per-OS accelerator automatically** _and_ make them discoverable in the menu
  bar: Save, **Close Tab** (`Cmd/Ctrl+W`), Quit, Minimize/Zoom, and the whole
  standard **Edit** menu (undo/redo/cut/copy/paste/select-all). We currently ship
  **no custom menu** — building one is part of this (and is why standard
  tab-switching is absent today).
- **Command registry + keybinding map** — app-specific commands (Quick Open,
  Command Palette, Find in Project, Focus Explorer, Switch Tab) bind to
  platform-appropriate defaults in one place (M15's registry).

Shortcuts, standards-first:

- **Save** `Cmd/Ctrl+S`, **Close tab** `Cmd/Ctrl+W`, **Find** `Cmd/Ctrl+F` —
  OS / near-universal, already used.
- **Switch tabs** — the OS standard: **`Ctrl+Tab` / `Ctrl+Shift+Tab`** (next /
  previous, cross-platform, ✅ built) and **`Cmd/Ctrl+1…9`** (jump to tab _N_, ✅
  built); macOS's **`Cmd+Shift+]` / `Cmd+Shift+[`** will come with the View menu.
- **Quick Open** `Cmd/Ctrl+P`, **Command Palette** `Cmd/Ctrl+Shift+P`, **Find in
  Project** `Cmd/Ctrl+Shift+F` — editor convention (VS Code), used.
- **Focus explorer** — `Cmd/Ctrl+Shift+E` (✅ built) focuses the tree, then its
  arrow-nav (M12) takes over. **Focus editor** — `Cmd/Ctrl+1` / `Esc` (not built
  yet). Not OS standards, so these are our convention.

**Status (honest):** tab switching (`Ctrl+Tab`, `Cmd/Ctrl+1…9`) and focus-explorer
(`Cmd/Ctrl+Shift+E`) are **built** and CDP-verified, so explorer ⇄ tabs is now
keyboard-driven. **Remaining:** the **native menu** (menu-bar discoverability +
standard File/Edit menus + `Cmd+Shift+[ / ]`) and a focus-editor shortcut.

## App settings (global) vs project config

Two tiers of configuration, stored **separately**:

- **Project config — `project.json`** (per project, in the folder). Describes the
  _project_ as **tool/editor configuration**: name, `explorer.ignore`, and
  per-project editor defaults (`wordWrap`, `diagnostics`, `defaultExtension`).
  **Story content — threads, entities — lives in files, not here** (decision #45).
  Travels with the folder; lives in the writer's repo.
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

### Model access & billing

The **primary AI-integration strategy is the MCP server** (below); the in-app
chat panel is a secondary, optional convenience.

- **writer-gui as an MCP server — the committed path.** See _MCP server_. The AI
  lives in the user's client; writer-gui exposes tools. **No API key, no metered
  charges** (runs on the user's existing subscription), and it's **not AI code in
  the app** — just deterministic tool exposure.
- **In-app chat panel (optional, deferred).** If someone wants AI _inside_
  writer-gui, it embeds a client needing the **Anthropic API (metered)** or
  **bring-your-own-key**. A Claude **Pro/Max subscription cannot be used here** —
  subscription OAuth is for Anthropic **first-party** clients (Claude Code /
  Desktop / official extension), not third-party apps. writer-gui **never ships
  its own key.**

## MCP server (writer-gui as tools) — committed

writer-gui exposes the open project as an **MCP server** so any MCP client
(Claude Code, Claude Desktop, the Claude VS Code extension) can reason over the
manuscript. **This is the committed AI-integration surface** — chosen because it
sidesteps API billing (the client carries the user's subscription), keeps AI code
out of writer-gui, and makes the deterministic prose "language server" reusable by
any client.

- **What it exposes** — **resources**: project files (read) + `project.json`;
  **tools** built on `StoryIndex`: `findReferences(entity)`, `definitionOf(entity)`,
  `mentionsIn(file)`, `threadBeats(thread)`, manuscript `order`, and
  project-wide search. So a prompt like _"is Mara's arc consistent?"_ is answered
  against the real index, not guessed.
- **The MCP server is deterministic, not AI** — no LLM, no key. It's the same
  `StoryIndex` the in-app providers use, projected over the Model Context
  Protocol. So it's a **committed** feature, not part of the deferred-AI lane.
- **Depends on `StoryIndex`** (Phase 5) for the valuable tools; file
  read/search resources could be exposed earlier. Runs in the main process.
- Writes (if any tool edits files) go through the **same guarded path** as the
  renderer — an MCP client can't reach outside the open project.

## Phases

Delivery is grouped into phases. Each phase is independently shippable and has a
clear exit criterion; milestones (M#) are the concrete steps inside it.

> **Status (2026-07-07):** Phases 0–4 ✅, Phase 6 ✅ (v1 Major Milestone) + the
> keyboard navigation, and **Phase 5 M8–M9 ✅** — `StoryIndex` + `@`-mention
> completion (M8), find-references + go-to-definition (M8c), Inspector pane (M8b),
> Companion pane (M8d, auto-follow + pin), and `ThreadProvider` + Threads panel
> (M9, file-level; inline markers deferred). Right-side panels are resizable.
> **Next in Phase 5:** M10 braid visualiser (read), then M11 (edit, stretch).
> Everything built is **CDP-verified**
> (launch with `ELECTRON_RUN_AS_NODE` unset; see the GUI-verify memory). Phase 6 =
> tabs/autosave/quick-open+palette/unified find/recent projects/resizable+
> keyboard-nav sidebar; Phase 4 = `AnalysisService` facade + spell provider; Phase
> 3 = file ops, search/replace, drag reorder, edit-safety. **Phases 7–12 are
> specced, not built** — note the reorder: the visual design system is now Phase 8
> (see decision #42).

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
  tests. It exercises the core model: `project.json` (tool config), manuscript
  files with sparse `order` + thread tags, and character profiles the prose
  mentions by name. Kept small and stable.

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

- **M8** ✅ — `StoryIndex` scanning the project + `CharacterProvider`, plus the
  find-references + go-to-definition UI. **Built:** the index (main;
  `story-index.ts`), the full YAML frontmatter parse (`parseFrontmatter`/
  `deriveTitle` in `frontmatter.ts`), type-generic entity extraction,
  `referencesTo`, IPC (`story:entities`/`story:references`), real `@`-mention
  completion from profile files (`CharacterProvider` replaced the demo), and
  **(M8c)** the **find-references panel** (`ReferencesPanel` — pick an entity →
  every mention grouped by file, click to jump with the mention highlighted) and
  **go-to-definition** (`lib/mentions.ts` `entityAt` resolves the entity under a
  cursor; Cmd/Ctrl+click a mention or the "Go to Definition" command → opens the
  profile). Surfaced via a toolbar "References" toggle + palette commands.
- **M8b** ✅ — **Inspector (file details) pane** — a read-only mirror of what
  `StoryIndex` parsed for the current file (title source, order + reading
  position, threads, mentions with counts, word count, parse warnings).
  `inspectFile` in main + `InspectorPanel`; toolbar toggle + palette command.
  See _Inspector (file details) pane_.
- **M8d** — **Reference companion pane** — keep the story bible at hand while
  drafting: a right-side pane that **auto-follows the scene** (shows the entities
  detected in the active file, reusing M8b's mention engine) with **pin-to-freeze**
  for project-long anchors. Read-first, collapse-to-summary, "open full" → tab.
  See _Reference companion pane_.
- **M9** ✅ _(file-level; inline deferred)_ — `ThreadProvider` (`buildThreads`) +
  a **Threads panel**: intersecting (many-to-many) threads, per-thread ordering,
  identity (name/colour/description) from optional `type: thread` entity files
  (decision #45); membership/order stay in each scene's frontmatter. Panel lists
  each thread's beats in order (click-to-open) with intersection (⋈) badges.
  Inline range markers move to **Phase 9 (M25b)** — same inline-decoration +
  strip-on-export pattern as CriticMarkup (decision #46); file-level feeds M10.
- **M10** ✅ _(MVP)_ — **Thread visualiser (read)** — `BraidView`: lane per thread,
  intersection crossings, ordering toggle (manuscript vs. follow-thread),
  click-to-open, on a pan/zoom SVG board (main pane). One **replaceable view** over
  the stable `ThreadProvider` model (`story:threads`) — a different visualization
  can drop in without touching the model. _Deferred:_ lane grouping/spacing (via a
  `group:` field on `type: thread` files) + drag-to-reorder lanes; widening the
  x-axis from threaded scenes to the whole manuscript.
- **M11** _(deferred — future, not MVP)_ — **Thread visualiser (edit)** — drag to
  reorder within a thread, move / add / remove membership; writes tags back to
  files. **Not part of the MVP.** Tree-drag reordering (M6) already covers the core
  "move things around" need, and editable-braid drag is costly. Revisit only if the
  read-only braid proves people want to _edit_ from it.

**Exit:** click a character → see every mention; follow a thread across chapters
in the braid. (Editing the braid is deferred future work, not part of the exit.)

### Phase 6 — Writing environment · 🏁 v1 Major Milestone ✅

The **"good enough" v1** — the point writer-gui becomes a comfortable daily
writing environment: multiple documents, safe editing, fast navigation, and one
coherent search. **Scoped to the milestones below** — not an open-ended polish
bucket.

- **M12** ✅ — Recent projects + a drag-**resizable sidebar**; the **app-settings
  store** (`settings.json` in user-data) that backs recent projects + global
  prefs. _Tree keyboard-nav still to do — the one remaining M12 bit._
- **M13** ✅ — **Tabs / multiple open documents.** The single-editor model became
  a collection (decision #4); each tab keeps its own live buffer + saved
  baseline, so switching tabs never writes and never loses unsaved edits. The
  unsaved prompt now fires only on **closing** a dirty tab.
- **M14** ✅ — **Autosave (opt-in)**, `editor.autosave` + a toolbar toggle, off by
  default; saves the active tab ~1s after it goes dirty. Whole-file write for
  now (patch-based diffing deferred); explicit `Cmd/Ctrl+S` stays the default.
- **M15** ✅ — **Quick Open (`Cmd/Ctrl+P`) + Command Palette (`Cmd/Ctrl+Shift+P`)**
  on a central command registry, one widget (`>` switches modes), fuzzy matcher.
- **M16** ✅ — **Unified find UI** — CodeMirror's `Cmd/Ctrl+F` panel themed to
  match the project-search panel / modals / quick-input (inputs, buttons, accent,
  match highlight). Full design-system unification is **Phase 8**.

**Exit (v1):** open or create a project, draft and structure a manuscript across
tabs without losing work, find anything (in-file, across the project, by
filename, by command), and reorder scenes — all keyboard-first. **After this
point we have a good-enough app.** _(All milestones visually verified via CDP.)_

### Phase 7 — Extended entities (worldbuilding) ✅

Generalize the story model beyond characters and threads to **any entity type**,
so worldbuilding — locations, items, factions, magic systems — links exactly the
way characters do. Post-v1, and the deterministic core only: entities as
referenceable pages. (Enforcing a magic system's _rules_ against the prose is
semantic and belongs to the AI `ContinuityProvider` — see _AI features_.)

- **M17** ✅ — **Type-generic `EntityProvider`.** Phase 5's `CharacterProvider`
  is now `createEntityProvider` (`entity-provider.ts`), parameterized by `type`
  (already the discriminator in profile frontmatter). Profile files of any `type` —
  `location`, `item`, `faction` / `organization`, `magic-system`, `artifact` —
  get the same `@`-mention completion, find-references, go-to-definition, plus
  **`name` + `aliases`** resolution off `StoryIndex`, with **no per-type code**.
  Unknown types work with defaults. (Was already type-generic; this retired the
  character-specific name.)
- **M18** ✅ — **Registered entity types** in `project.json` `entityTypes`:
  display name, icon, colour, **and the fields each type declares**. Built-in
  defaults (character, location, item, faction, magic-system, thread) live in
  `src/shared/entity-types.ts`; project config merges _over_ them via
  `resolveEntityTypes`. The tree badges a location vs. an item, and the
  inspector/companion/references type badges carry the icon (lightweight —
  emoji + colour, real styling deferred to Phase 8). (Type _schema_ — tool config,
  not story content, so unlike threads it stays in `project.json`; cf. #45.)
- **M19** ✅ — **Frontmatter intellisense.** Completion _inside_ the YAML block,
  delivered as a `frontmatter` provider through the `AnalysisService` facade
  (`lib/frontmatter-context.ts` classifies key vs. value; the editor's completion
  delegate now triggers on any word in the block, not just `@`). Suggests
  **attribute keys** (`type`, `name`, `aliases`, `order`, `threads`, plus the
  file's `type` fields) and **their values** — `type:` → registered types,
  `threads:` → `type: thread` entities, enum-ish fields → their set. Schema-driven
  off M18 + `StoryIndex`; unknown types fall back to the common keys.
- **M20** ✅ — **New-file entity templates.** Creating a file offers a **template
  per registered entity type** (`entityTemplate`) that pre-fills the frontmatter
  skeleton (`type` + `name` + `aliases` + the type's declared fields) and a
  starter heading, driven by the M18 registry. Surfaced both in the New-File
  modal's type picker (`NewFileModal`) and as palette commands ("New Character",
  "New Location", …); a blank Markdown file stays the default.

**Exit:** `@{Redhill}` resolves to the location page whose canonical name is
"Giant's Rest" (via aliases), just like a character; every entity type shares one
code path; typing in a profile's frontmatter suggests the right keys and values,
and "New Location" starts from a filled-in template.

### Phase 8 — Visual design system & writer theme

Replace the ad-hoc CSS grown through Phases 2–6 with a **cohesive design system**
and a visual language **tuned for writers to feel comfortable** during long
sessions. The goal is beauty + consistency, not new features. Pulled ahead of the
editorial/analysis/MCP phases so the app gets a coherent visual language early —
now that Claude Design access is authorized.

- **M21** — **Design tokens + component library.** A single source of truth for
  color, a type scale, spacing, radius, and shadows; the app's surfaces (tree,
  tabs, editor chrome, modals, quick-input, search, status bar) restyled to
  consume them so everything reads as one system.
- **M22** — **Writer-comfort theme(s).** Low-eye-strain light + dark themes tuned
  for reading/writing (warm paper option, gentle contrast, calm accents), and a
  distraction-light **focus** mode. Themes are a token swap, not per-component
  overrides.
- **Sourced via Claude Design.** The component library / tokens are maintained in
  a **claude.ai/design** design-system project and synced into the repo with the
  `DesignSync` tool + `/design-sync` skill. Requires an **interactive
  `/design-login`** (a normal CLI session) — can't be authorized in a headless
  run. Alternatives if not using Claude Design: "Send to Claude Code Web" seeds
  the project, or hand off tokens/components directly.

**Exit:** the whole app reads as one intentional, calm visual language; switching
theme is one token change; nothing looks like ad-hoc CSS.

### Phase 9 — Editorial marks (comments & revisions)

Post-v1 editorial layer, plain-text via CriticMarkup — see _Comments & editorial
marks_. Reuses the decoration + hover-tooltip machinery already in the editor.

- **M23** — **Anchored comments.** `{>>…<<}` (at a point) and
  `{==span==}{>>…<<}` (attached to a span), rendered as a highlight + hover
  tooltip, edit-in-source; stripped on export. Reuses the `%%`-notes decoration
  pattern.
- **M24** _(optional)_ — **Comments panel** — a per-file list of comments
  (click-to-jump), surfaced through the inspector / analysis facade.
- **M25** _(stretch)_ — **Suggested edits / tracked changes** — CriticMarkup
  insert / delete / substitute marks, accepted or rejected on export.
- **M25b** _(from M9)_ — **Inline thread markers** — a `<!-- thread:x -->…
  <!-- /thread -->` span scoping part of a scene to a thread, so one file feeds
  several threads at different points. Rides this phase's inline-decoration +
  strip-on-export machinery; extends `buildThreads` with sub-scene beats that the
  braid (M10) then renders.

**Exit:** highlight a sentence, attach a private comment that survives editing
around it, and confirm it never reaches the exported prose.

### Phase 10 — External analysis providers (opt-in)

Bring third-party grammar/style engines in as providers behind the existing
`AnalysisService` facade — **no editor or facade change** (this is exactly what
the pluggable design was for).

- **M26** — A **main-process provider** that calls an external checker's API,
  maps results → `Diagnostic[]`, and emits through the facade. First targets:
  **LanguageTool** (open-source, **self-hostable** so prose can stay on-device;
  or cloud) and **ProWritingAid** (developer API). _Grammarly has no third-party
  editor API, so it's out._
- **M27** _(optional)_ — **`LspProvider`**: attach a real language server over
  JSON-RPC (e.g. `ltex-ls` for LanguageTool) — the deferred-LSP path realized.

Rules: **opt-in, off by default** (the diagnostics toggle); the **API key lives
in main** (the renderer never sees it); sending prose to a cloud service is
**disclosed** (self-hosted LanguageTool avoids it entirely). Ships **named**
integrations — a full user-installable plugin SDK (arbitrary sandboxed
third-party providers) is a bigger, separate _Deferred_ item.

**Exit:** enable LanguageTool; its grammar/style hits appear as squiggles through
the same facade as the built-in spell provider, opt-in.

### Phase 11 — MCP server (committed)

Expose the project as an **MCP server** so a subscription-authed client drives AI
over the manuscript — no API key, no metered cost, no AI code in the app. See
_MCP server_. Deterministic (it's `StoryIndex` projected over MCP), so it sits
here in the committed phases, not in the deferred-AI lane. Depends on Phase 5.

- **M28** — MCP server exposing project files (resources) + `StoryIndex` tools
  (`findReferences`, `definitionOf`, `mentionsIn`, `threadBeats`, order, search),
  writes routed through the same guarded path. Connect from Claude Code / Desktop.

**Exit:** connect writer-gui as an MCP server in Claude Desktop and ask a
grounded question ("summarise the rebellion thread") answered from the real index
— on your subscription, no API charges.

### Phase 12 — Command system & keybindings

Unify commands behind **one registry** and make keys **user-overridable** — see
_Command registry_ and _Keyboard navigation & focus_. Fixes the two-sources-of-
truth trap (an ad-hoc palette array + hand-written keydown switch + a hardcoded
menu) and keeps the native menu behind the shell seam.

- **M29** — **Command registry.** One renderer-owned registry
  (`{ id, title, category, defaultKeybinding, run }`) becomes the single source
  for the **palette** and the **keyboard shortcuts** (replacing App's ad-hoc
  `commands` array and the hand-written keydown switch).
- **M30** — **Generated native menu.** Build the Electron `Menu` from the
  registry (renderer → main IPC), `registerAccelerator: false` so shown shortcuts
  don't hijack keys from the renderer / CodeMirror; adds menu-bar discoverability,
  standard File/Edit/View menus, macOS clipboard (Edit roles), and
  `Cmd+Shift+[ / ]`. The menu builder is the **only** shell-specific part (seam,
  decision #24) — plus a **focus-editor** shortcut to finish region nav.
- **M31** — **User keybindings.** A `keybindings.json` in the app-settings
  user-data dir remaps any command; the registry merges `defaultKeybinding` +
  overrides into the **effective** binding shown in the palette and menu.
  Editor-owned keys (`⌘Z`, `⌘F`) documented as reserved.

**Exit:** one registry feeds the palette, shortcuts, and menu; a writer can remap
any command in `keybindings.json` and see it reflected everywhere; the menu stays
replaceable with the shell.

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
  a small settings **form** (name, word-wrap, diagnostics default, ignore list)
  that reads/writes the config while **preserving unknown
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

Moved to **[DECISIONS.md](DECISIONS.md)** — the append-only log of the choices
behind this spec and _why_ (decisions #1–45), split out to keep this file
focused. Referenced throughout by number (e.g. decision #45).
