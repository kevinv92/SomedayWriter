# Architecture

_Part of the [SomedayWriter spec](./README.md)._

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
