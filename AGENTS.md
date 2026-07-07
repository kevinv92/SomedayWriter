# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Keep changes
consistent with what's here. For the product design and roadmap, read
[SPEC.md](SPEC.md) — especially **[DECISIONS.md](DECISIONS.md)**, which records _why_
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

## Git hooks

Native hooks live in `.githooks/` and are activated automatically on
`npm install` (the `prepare` script sets `core.hooksPath`). No Husky.

- **pre-commit** → `lint-staged`: `eslint --fix` + `prettier --write` on staged
  files only (fast).
- **pre-push** → `npm run typecheck && npm run lint` across the repo.

Bypass in a pinch with `git commit --no-verify` — but fix it, don't leave it.

## Standards & practices

- **Security is non-negotiable.** `contextIsolation: true`, `sandbox: true`,
  `nodeIntegration: false`. The renderer must **never** import `fs`/Node or use
  IPC channel strings directly. Every capability the UI needs is an explicit,
  typed method on `window.api` (declared in `src/preload`). Add there first.
- **TypeScript, strict.** No `any` unless justified with a comment. Share types
  across process boundaries rather than redefining them.
- **Match surrounding style.** Prettier settings: no semicolons, single quotes,
  no trailing commas, 90-col. Run `npm run format` before committing.
- **Keep seams intact.** Three deliberate abstraction boundaries exist so pieces
  stay swappable — do not bypass them:
  - `EditorAdapter` — only the adapter module imports CodeMirror.
  - `AnalysisService` — the editor talks to this facade, never to a provider.
  - **`window.api` — the desktop-shell seam.** The renderer must be shell-
    agnostic: it never imports Electron, `fs`, Node, or `ipcRenderer`, and never
    references a channel string — it only calls typed methods on `window.api`.
    All shell-specific code (windows, dialogs, filesystem, IPC handlers) lives in
    `src/main` + `src/preload`; the IPC payload types live in `src/shared` so
    they're shell-independent. **Why:** this keeps Electron replaceable (e.g.
    Tauri) — a shell swap should touch only `src/main`/`src/preload`, never
    `src/renderer`. Don't leak Electron types or Node APIs into the renderer or
    into `src/shared`, and don't grow `window.api` with shell-specific concepts
    (pass plain data, not `BrowserWindow`/`Dialog` handles).
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

## Contributing — workflow & keeping docs in sync

Code is only half the job; the docs are the memory that survives across sessions.
When you change something, update the record in the same change.

**`SPEC.md` — the design + decision record. Update it when:**

- You **finish a phase or milestone** → mark it done (`✅`) and update the
  **Status** line at the top of the Phases section (what's done, what's next).
- You **make a non-trivial decision** (a choice with a trade-off, a scope
  change, a reversal) → append a numbered entry to **[DECISIONS.md](DECISIONS.md)** with the
  _why_. Never silently contradict an existing entry — add a new one that
  supersedes it and say so.
- **Behavior or a contract changes** (an interface, a config key, the export
  rules, a feature's shape) → edit the relevant section so the prose matches
  reality. Stale spec is worse than no spec.

**`AGENTS.md` (this file) — update when:**

- Project structure, tooling, commands, or a standard changes.
- A new seam/convention is introduced that future work must respect.

**Other files:**

- **`examples/sample-project/`** — keep the fixture in sync with the model. If
  you add a frontmatter field or change the entity/thread shape, reflect it here
  so it stays a valid, useful test target. Keep it small and stable.
- **`README.md`** — human-facing; update the status blurb, features, or scripts
  when they change. Don't put design rationale here (that's SPEC.md).
- **Project memory** (`MEMORY.md` + `memory/`) — when the "where we are / what's
  next" changes materially, update the status memory so a fresh session resumes
  correctly.

**Editing large docs efficiently (SPEC.md / DECISIONS.md):** for **mechanical,
repetitive** changes — renumbering milestones/decisions, a phrase find-replace
across many spots, or moving a whole section — prefer a single `perl -i`/`sed`
(or `head`/`tail` for a split) in one Bash call over many `Edit`s. It's far
cheaper in context and deterministic. Example:
`perl -i -pe 's{\bthread registry\b}{type: thread entities}g' SPEC.md`.
Reserve `Edit` for genuine rewording where judgement is needed. After a `perl`
sweep, `grep` to confirm no stale matches remain.

**Commits & verification:**

- Verify first: `npm run format && npm run lint && npm run typecheck &&
npm run build` clean; launch `npm run dev` if runtime behavior changed.
- One logical change per commit. Imperative subject; body explains _why_ and
  notes any spec/docs updated in the same commit.
- End commit messages with the `Co-Authored-By: Claude …` trailer (project
  preference).
- Commit or push only when asked. If work isn't committed, don't claim it is.

**Definition of done:** code works _and_ is verified, the spec/docs reflect it,
and the decision (if any) is logged.

## For AI indexing

- Generated/vendored dirs (`node_modules/`, `out/`, `dist/`) are git-ignored and
  listed in `.cursorignore` — **don't index or read them**; they're noise.
- Start from `SPEC.md` (design) and this file (practices) before reading source.
- The source of truth for _decisions_ is **DECISIONS.md**.
- `npm run pack:ai` runs **repomix** → a single-file digest (`repomix-output.xml`)
  of the whole repo for pasting into an LLM. Config: `repomix.config.json`;
  extra excludes: `.repomixignore`. The output is git-ignored.
