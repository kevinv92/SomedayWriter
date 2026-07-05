# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Keep changes
consistent with what's here. For the product design and roadmap, read
[SPEC.md](SPEC.md) — especially its **Decision history**, which records _why_
choices were made so they aren't re-litigated.

## What this is

`writer-gui` is an **Electron** desktop **Markdown** writing tool: a file
explorer on the left, a CodeMirror editor on the right. Content is plain `.md`
files on disk; a `project.json` at a folder's root marks it as a "Project".

## Tech stack

- **Electron** (main + preload + renderer), bundled with **electron-vite**.
- **Renderer**: React + TypeScript + Vite.
- **Editor** (later phases): CodeMirror 6, behind an `EditorAdapter` seam.
- **Config**: `project.json` parsed with native `JSON`.
- Tooling: **ESLint** (flat config) + **Prettier**.

## Project layout

```
src/
  main/       Electron main process — owns fs, windows, IPC handlers (Node)
  preload/    contextBridge — the ONLY renderer↔main surface (window.api)
  renderer/   React UI (sandboxed; no direct fs/Node)
electron.vite.config.ts   build config for all three
examples/
  sample-project/   a real writer-gui Project fixture (open it while developing;
                    assert against it in tests) — project.json, manuscript/*.md
                    with order + thread tags, characters/*.md profiles
```

## Commands

```
npm run dev          # launch app with hot-reload
npm run build        # production build to out/
npm run typecheck    # tsc for node + web projects
npm run lint         # eslint
npm run format       # prettier --write
```

## Standards & practices

- **Security is non-negotiable.** `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`. The renderer must **never** import `fs`/Node or use
  IPC channel strings directly. Every capability the UI needs is an explicit,
  typed method on `window.api` (declared in `src/preload`). Add there first.
- **TypeScript, strict.** No `any` unless justified with a comment. Share types
  across process boundaries rather than redefining them.
- **Match surrounding style.** Prettier settings: no semicolons, single quotes,
  no trailing commas, 90-col. Run `npm run format` before committing.
- **Keep seams intact.** Two deliberate abstraction boundaries exist so pieces
  stay swappable — do not bypass them:
  - `EditorAdapter` — only the adapter module imports CodeMirror.
  - `AnalysisService` — the editor talks to this facade, never to a provider.
- **Markdown is canonical.** On-disk and in-memory content is Markdown text.
  Don't introduce a proprietary document format.
- **Diagnostics (squiggles) are off by default.** Don't wire analysis to nag;
  it's opt-in. Pull features (completions/references) stay on.
- **Verify before claiming done.** Run `typecheck`, `lint`, and `build`. If you
  changed runtime behavior, launch the app (`npm run dev`) and confirm it.
- **Conventional-ish commits.** Short imperative subject; body explains _why_.

## Coding guidelines

**Naming**

- `camelCase` for variables/functions, `PascalCase` for types & React
  components, `SCREAMING_SNAKE_CASE` for module-level constants.
- Files: React components `PascalCase.tsx`; everything else `kebab-case.ts`.
- Name for intent, not type: `characterIndex`, not `data` or `obj`.

**Types**

- Prefer `type` aliases; `interface` only for extendable public shapes (like
  `EditorAdapter`, `AnalysisProvider`).
- No `any` — reach for `unknown` + narrowing. No non-null `!` on values that can
  realistically be null; guard instead.
- Model absence explicitly (`T | null`), and discriminated unions over boolean
  flags for multi-state values.

**Functions & modules**

- Small, single-purpose functions; early-return over nested `if`.
- One module = one responsibility. Keep main/preload/renderer concerns separate;
  shared types go in a shared location, not copy-pasted.
- Pure logic (parsing, indexing, ordering) stays free of Electron/React imports
  so it's unit-testable in isolation.

**Async & errors**

- `async/await`, never floating promises — `await` or explicitly `void` them.
- Handle IPC failures at the call site; surface a real message to the user, not
  a swallowed catch. Never `catch {}` silently.
- No `throw` across the IPC boundary raw — return typed results/errors.

**React (renderer)**

- Function components + hooks only. Follow the rules of hooks (the lint enforces
  it). Keep `useEffect` deps honest.
- Derive state; don't duplicate it. Lift state only as far as needed.
- No business logic or `fs`/IPC strings in components — call `window.api`.

**IPC / security (repeat, because it matters)**

- Add a typed method to `window.api` for any new main-process capability; never
  expose raw `ipcRenderer` or channel strings to the UI.
- Validate/normalize paths in the main process; treat renderer input as
  untrusted.

**Comments**

- Explain _why_, not _what_. Delete commented-out code. A TODO must say who/what:
  `// TODO(threads): handle cross-file ranges`.

**Before you finish**

- `npm run format && npm run lint && npm run typecheck && npm run build` all
  clean. Don't disable a lint rule to pass — fix the code or justify inline.

## For AI indexing

- Generated/vendored dirs (`node_modules/`, `out/`, `dist/`) are git-ignored and
  listed in `.cursorignore` — **don't index or read them**; they're noise.
- Start from `SPEC.md` (design) and this file (practices) before reading source.
- The source of truth for _decisions_ is `SPEC.md` → Decision history.
- `npm run pack:ai` runs **repomix** → a single-file digest (`repomix-output.xml`)
  of the whole repo for pasting into an LLM. Config: `repomix.config.json`;
  extra excludes: `.repomixignore`. The output is git-ignored.
