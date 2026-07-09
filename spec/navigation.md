# Navigation: search, quick-open, palette & keyboard

_Part of the [SomedayWriter spec](./README.md)._

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
