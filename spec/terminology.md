# Terminology

_Part of the [SomedayWriter spec](./README.md)._

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
