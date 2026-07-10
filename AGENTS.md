# AGENTS.md

Guidance for AI coding agents (and humans) working in this repo. Keep changes
consistent with what's here. For the product design and roadmap, read the
[spec](spec/) (sliced by subsystem; start at [spec/README.md](spec/README.md)) —
especially **[DECISIONS.md](DECISIONS.md)**, which records _why_ choices were made
so they aren't re-litigated.

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

## Design system

The whole visual language lives as CSS custom properties in
`src/renderer/src/index.css` (`:root`). There are two built-in themes — **Warm
Paper** (light) and **Warm Dusk** (dark) — plus a user-cyclable accent. **The
one rule: style through the tokens, never hardcode.** A new component that uses
`var(--…)` inherits theme, accent, and focus mode for free; a hardcoded
`#f4f1ea` or `12px` silently breaks in the other theme. When adding UI, copy the
closest existing component's markup and classes and swap the content — don't
invent a new pattern.

**Tokens** (use these, not raw values):

- **Color** — `--bg`, `--bg-1/2/3` (raised surfaces, ascending); `--fg`,
  `--fg-2/3/4` (text, descending emphasis); `--muted` (= `--fg-3`); `--accent`,
  `--accent-soft` (translucent), `--accent-fg` (text on accent). The six accent
  hues the user cycles are `--accent-{ink,sage,clay,plum,gold,slate}` — don't
  reference those directly; use `--accent`.
- **Type** — `--font-reading` / `--font-display` (serif, for editorial/content),
  `--font-ui` (system sans, for chrome), `--font-mono`. Sizes `--text-xs` (11px)
  → `--text-4xl` (39px). Weights `--weight-regular` / `--weight-medium` /
  `--weight-semibold` (400/500/600).
- **Space** — `--space-1`…`--space-9` (2, 4, 8, 12, 16, 24, 32, 48, 64px). Lay
  out with `gap`, not per-element margins.
- **Radius** — `--radius-xs/sm/md/lg/full`.

**Icons** — add via the `Icon` component. Follow the icon rule (see
`Icon.tsx`): **dimensional/glossy = domain content** (a character, a thread, an
entity); **flat line = UI chrome** (rail, menus, chevrons, close, reload).

**Class naming** — BEM-ish `block__element--modifier`
(`.menubar__item--active`, `.help__version`). Watch selector specificity: a
type-based selector fighting an element-based one over spacing is the usual
cascade bug. Both themes must stay legible — never style directly inside a
`prefers-color-scheme` block; redefine tokens there and style through them.

Handing an unstyled component to an agent works well _because_ of this system:
point it at `index.css` and a sibling component, and say "style with our tokens,
matching `<X>`."

## Contributing — workflow & keeping docs in sync

Code is only half the job; the docs are the memory that survives across sessions.
When you change something, update the record in the same change.

**`spec/` — the design record (sliced by subsystem). Update the relevant file
when:**

- You **finish a phase or milestone** → mark it done (`✅`) and update the
  **Status** line at the top of the Phases section in
  [spec/roadmap.md](spec/roadmap.md) (what's done, what's next).
- You hit a feature that **needs design before coding** (open _how_ questions) →
  add or update an entry in [spec/todo/](spec/todo/README.md); close it when the design
  lands (a section + a DECISIONS entry).
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
  when they change. Don't put design rationale here (that's `spec/`).
- **Project memory** (`MEMORY.md` + `memory/`) — when the "where we are / what's
  next" changes materially, update the status memory so a fresh session resumes
  correctly.

**Editing large docs efficiently (`spec/*.md` / DECISIONS.md):** for **mechanical,
repetitive** changes — renumbering milestones/decisions, a phrase find-replace
across many spots, or moving a whole section — prefer a single `perl -i`/`sed`
(or `head`/`tail` for a split) in one Bash call over many `Edit`s. It's far
cheaper in context and deterministic. Example:
`perl -i -pe 's{\bthread registry\b}{type: thread entities}g' spec/story-model.md`.
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
- Start from `spec/` (design) and this file (practices) before reading source.
- The source of truth for _decisions_ is **DECISIONS.md**.
- `npm run pack:ai` runs **repomix** → a single-file digest (`repomix-output.xml`)
  of the whole repo for pasting into an LLM. Config: `repomix.config.json`;
  extra excludes: `.repomixignore`. The output is git-ignored.
