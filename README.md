# writer-gui

A desktop **Markdown** writing tool for prose projects (novels, scripts, docs).
File explorer on the left, editor on the right. Your work stays as ordinary
`.md` files on disk — no proprietary format, no lock-in.

> **Status:** early development. Phase 0 (scaffold) is in place — the Electron
> shell boots and the secure IPC bridge round-trips a ping. Features land in
> phases; see [SPEC.md](SPEC.md) for the full design and roadmap.

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
