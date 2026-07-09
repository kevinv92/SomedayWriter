# writer-gui

A desktop **Markdown** writing tool for prose projects (novels, scripts, docs).
File explorer on the left, editor in the middle, story panels on the right. Your
work stays as ordinary `.md` files on disk — no proprietary format, no lock-in. A
folder becomes a project when it has a `project.json`.

Built to be **deterministic and quiet by default**: the story intelligence is
real indexing, not guesswork, and nothing nags you unless you ask it to. AI is
opt-in and runs on _your_ client — see [AI & grammar](#ai--grammar).

> **Status:** Phases 0–11 complete. Only the unified command/keybinding system
> (Phase 12) and the deferred lane (AI continuity, export/compile) remain. See
> [SPEC.md](SPEC.md) for the full design and roadmap, and
> [DECISIONS.md](DECISIONS.md) for the _why_.

---

## Features

### Writing & editing

- **CodeMirror 6 editor** with Markdown, a reading-optimized measure/typography,
  and a soft reading-column tint.
- **Live syntax softening** — `@{mentions}` show just the name at rest and reveal
  their `@{…}` braces when your cursor enters them; CriticMarkup wrappers
  (`{++insert++}`, `{--delete--}`, `{==highlight==}`) hide their delimiters the
  same way. Prose reads clean; the markup is a keystroke away.
- **Formatting toolbar + shortcuts** — bold/italic/headings/lists/quote/link and
  editorial comment, with `⌘B` / `⌘I` / `⌘K`. Hidden in Vim and focus modes.
- **Real Vim mode** (`@replit/codemirror-vim`) with a status-bar mode chip, a
  mode-colored cursor, and display-line `j`/`k` motion for wrapped prose.
- **Focus mode**, configurable font/size/line-height/measure (per project), and a
  **Markdown & syntax reference** cheat-sheet.
- **Format Table** — tidy a raw GFM table's columns from the palette.
- **Images** — inline preview of `![](…)` (via a guarded `writer-asset://`
  protocol), insert from a picker or drag-and-drop, and a read-only viewer for
  image files.

### Files, tabs & navigation

- **File explorer** — new / rename / delete / drag-to-move / drag-to-reorder;
  per-type entity icons; a pinned quick-access section.
- **Tabs** with per-tab unsaved buffers (switching never loses edits) and opt-in
  **autosave**; unsaved-changes prompt on close.
- **Quick Open** (`⌘P`, fuzzy — matches name _and_ project-relative path) and a
  **command palette** (`⌘⇧P`); both surface recent files / commands first.
- **Find in document** (`⌘F`) and **find across the project** (`⌘⇧F`).
- **Back / forward history** (`⌘[` / `⌘]`) plus `‹ ›` menubar buttons.

### Story intelligence (the `StoryIndex`)

The project is indexed into a deterministic story model — the same index the
editor, the panels, and the [MCP server](#claude-as-your-editor-mcp) all read, so
nothing drifts.

- **Entities** — any profile file with a `type` in its frontmatter: characters,
  locations, items, factions, magic-systems, threads (all extensible per
  project).
- **Mentions** — explicit `@{surface}` references (name or alias), with
  **`@`-completion** from your real profiles. No bare-text auto-linking, so no
  false positives.
- **Find references** and **go-to-definition** (Cmd/Ctrl-click a mention) — "find
  usages / jump to definition," for prose.
- **Panels** — an **Inspector** (what the app parses from a file), a **Companion**
  that auto-follows the current scene's entities (with pin-to-freeze), a
  **References** browser, **Threads**, and a **Project Threads · Timeline** braid
  visualiser (one lane per thread, intersections, branch/merge topology).
- **Project Health** — every `@{surface}` that no longer resolves (a dead
  reference from a rename or typo), click-to-jump.
- **Alias rename refactor** — rename a character in its frontmatter and the app
  offers to rewrite every `@{old}` → `@{new}` across the manuscript.
- **Entity tooling** — a per-project entity-type registry, frontmatter
  intellisense (`type:` / `threads:` / enum fields), and new-file templates.

### Editorial marks (CriticMarkup)

- **Comments** `{>>…<<}` and **highlights** `{==…==}`, with a hover preview and a
  **Comments panel** that lists every note with click-to-jump.
- **Tracked changes** — suggest insertions/deletions/substitutions and
  **accept/reject** the change at the cursor.
- **Inline thread markers** (`<!-- thread:x -->`) scope part of a scene to a
  thread.

### Look & feel

- A warm, low-eye-strain **design system** — "warm paper" (light) and "warm dusk"
  (dark) themes, six accents, and **custom themes** (project- or user-defined via
  ~20 CSS-var overrides).
- A cohesive **custom SVG icon set** (glossy solids for entities, flat lines for
  chrome).

### AI & grammar

Everything here is **opt-in and off by default**; the core app needs none of it.

- **Grammar & style** behind a pluggable analysis facade (alongside the built-in
  spell check), via **[LanguageTool](https://languagetool.org)** — either its
  **HTTP API** (self-hostable, so prose stays on-device) or a **real language
  server over LSP** (e.g. `ltex-ls`, a live push connection). Configure a
  `grammar` block in `settings.json`; any API key lives in the main process and
  never reaches the UI. Rides the diagnostics toggle like every other provider.

#### Claude as your editor (MCP)

writer-gui ships a **[Model Context Protocol](https://modelcontextprotocol.io)
server** so **Claude Desktop / Code** can reason over your _real_ manuscript — on
your subscription, with no API key, no metered cost, and no AI code in the app. It
reuses the exact same `StoryIndex`, exposing every file as a **resource** plus
tools: `project_overview`, `search_project`, `list_entities`, `find_references`,
`definition_of`, `mentions_in`, `thread_beats`, `reading_order`, `read_file`, and
a root-guarded `write_file`.

Point Claude at it (root via `--root` or `WRITER_PROJECT_ROOT`):

```jsonc
{
  "mcpServers": {
    "writer-gui": {
      "command": "/abs/path/writer-gui/node_modules/.bin/tsx",
      "args": [
        "/abs/path/writer-gui/src/mcp/server.ts",
        "--root",
        "/abs/path/to/your/project"
      ]
    }
  }
}
```

Then ask grounded questions — _"summarise the rebellion thread"_, _"where is Irene
Adler mentioned?"_ — answered from the real index.

---

## Getting started

Requires **Node 20+**.

```bash
npm install      # install dependencies
npm run dev      # launch the app with hot-reload
```

Open the bundled example to explore everything above:
`examples/scandal-in-bohemia/` (a public-domain Conan Doyle project with
characters, locations, items, a faction, and six interwoven threads).

## Scripts

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Launch the app in development (hot-reload) |
| `npm run build`     | Production build to `out/`                 |
| `npm run mcp`       | Run the MCP server (`-- --root <project>`) |
| `npm run typecheck` | Type-check main + renderer                 |
| `npm run lint`      | Lint with ESLint                           |
| `npm run format`    | Format with Prettier                       |
| `npm run package`   | Build a distributable app                  |

Git hooks are set up automatically on `npm install`: **pre-commit** formats and
lints staged files; **pre-push** runs a full type-check + lint.

## Project layout

```
src/
  main/       Electron main process — filesystem, IPC, StoryIndex,
              grammar (LanguageTool HTTP) + LSP client
  preload/    Secure bridge — the only renderer↔main surface (window.api)
  renderer/   React UI (App composes focused hooks under renderer/src/hooks)
  mcp/        Standalone MCP server (reuses the StoryIndex; run via tsx)
  shared/     Types shared across the process boundary (aliased @shared)
```

## Tech stack

Electron + Vite + React + TypeScript, bundled with
[electron-vite](https://electron-vite.org). Editor: CodeMirror 6. MCP via
`@modelcontextprotocol/sdk`.

## Contributing

Standards and conventions live in [AGENTS.md](AGENTS.md); the design rationale and
decision log live in [SPEC.md](SPEC.md) / [DECISIONS.md](DECISIONS.md). Please read
them before making changes.

## License

MIT
