# writer-gui

A desktop **Markdown** writing tool for prose projects (novels, scripts, docs).
File explorer on the left, editor on the right. Your work stays as ordinary
`.md` files on disk — no proprietary format, no lock-in.

> **Status:** early development. **Phases 0–4 + Phase 6 (the v1 milestone)
> complete.** Open or create a project; browse and manage files (new / rename /
> delete / drag-to-move / drag-to-reorder); edit across **tabs** with per-tab
> unsaved buffers and optional autosave; **Quick Open** (`Cmd/Ctrl+P`) and a
> **command palette** (`Cmd/Ctrl+Shift+P`); find in a document (`Cmd/Ctrl+F`) and
> across the project (`Cmd/Ctrl+Shift+F`); recent projects, a resizable sidebar,
> configurable editor typography; and pluggable analysis (`@`-mention completion
> from your project's real character profiles, with an opt-in spell check).
> **Phase 5 (story intelligence) is in progress** — the `StoryIndex` and
> character linking are landing (find-references + a thread visualiser next). See
> [SPEC.md](SPEC.md) for the full design and roadmap.

## What makes it different

- **Character linking** — see everywhere a character is mentioned; jump to their
  profile (like "find references" / "go to definition", for prose).
- **Story threads** — tag scenes into subplots and follow a thread across
  chapters, with a braid-style visualiser.
- **Keyboard-first editing** — built on CodeMirror with real Vim support.
- **Quiet by default** — no nagging squiggles unless you turn them on.

(All deterministic — no AI required for the core. AI-assisted features are
planned separately and opt-in.)

## Tech stack

Electron + Vite + React + TypeScript, bundled with
[electron-vite](https://electron-vite.org). Editor: CodeMirror 6.

## Getting started

Requires **Node 20+**.

```bash
npm install      # install dependencies
npm run dev      # launch the app with hot-reload
```

## Scripts

| Command             | What it does                               |
| ------------------- | ------------------------------------------ |
| `npm run dev`       | Launch the app in development (hot-reload) |
| `npm run build`     | Production build to `out/`                 |
| `npm run typecheck` | Type-check main + renderer                 |
| `npm run lint`      | Lint with ESLint                           |
| `npm run format`    | Format with Prettier                       |
| `npm run package`   | Build a distributable app                  |

Git hooks are set up automatically on `npm install`: **pre-commit** formats and
lints staged files; **pre-push** runs a full type-check + lint.

## Project layout

```
src/
  main/       Electron main process (filesystem, windows, IPC)
  preload/    Secure bridge — the only renderer↔main surface (window.api)
  renderer/   React UI
```

## Contributing

Standards and conventions live in [AGENTS.md](AGENTS.md); the design rationale
and decision log live in [SPEC.md](SPEC.md). Please read both before making
changes.

## License

MIT
