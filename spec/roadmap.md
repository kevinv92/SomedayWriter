# Roadmap, phases & deferred

_Part of the [SomedayWriter spec](./README.md)._

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
   [navigation.md](./navigation.md).
   _Near-essential; a writer needs find/replace on day one (find a phrase, rename
   a place everywhere)._
9. **Reorder & manuscript order** — an explicit ordering of scenes/chapters,
   editable by **drag in the tree**. Order is the spine the visualiser x-axis and
   any future export both read. _Near-essential._

Order is stored per file (frontmatter `order`, sparse/fractional so a single
insert is one write) — see [manuscript.md](./manuscript.md).

## Phases

Delivery is grouped into phases. Each phase is independently shippable and has a
clear exit criterion; milestones (M#) are the concrete steps inside it.

> **Status (2026-07-10):** **Phases 0–11 are built and merged.** That covers the
> Electron scaffold + file model (0–3), the analysis facade (4), the full story
> index — entities/mentions/references, Inspector, Companion, Threads + the braid
> visualiser (5, incl. M10), extended entity types + frontmatter intellisense +
> templates (7), the **visual design system** + themes + icons (8), **editorial
> marks** — comments, highlights, tracked changes, inline thread markers (9),
> **external grammar/LSP analysis** — LanguageTool HTTP + a real LSP client (10),
> and the **MCP server** (11). Beyond the original plan, this line also shipped
> **manuscript export (Markdown + EPUB)**, a **Vitest** test suite, and
> **GitHub + CI + a tagged-release DMG workflow**.
>
> **Remaining:** Phase 12 (unified command/keybinding system) and the deferred
> lane — AI continuity (`ContinuityProvider`) and more export targets. M11 (edit
> the braid) stays deferred. Everything built is **CDP-verified** (launch with
> `ELECTRON_RUN_AS_NODE` unset). NB the visual design system was pulled forward to
> Phase 8 (decision #42).

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

**Built — M26 (LanguageTool):** `src/main/grammar.ts` POSTs to a LanguageTool
`/v2/check` endpoint and maps `matches[]` → the shared `GrammarMatch` (offset
form); the renderer `createLanguageToolProvider` (registered behind the facade
next to spell) requests a check on `didChange` and maps `GrammarMatch` →
`Diagnostic`, with a request-sequence guard so a stale async response for a
superseded edit is dropped. **No editor or facade change** — the diagnostics
toggle gates it like every other provider. **Opt-in via `settings.json`** (global
app settings, hand-edited like `userThemes`), off until set:

```jsonc
"grammar": {
  "enabled": true,
  "url": "http://localhost:8081",   // self-hosted LanguageTool (prose stays local)
  "language": "en-US",              // or "auto"
  "motherTongue": "en-US",          // optional, improves false-friend detection
  "username": "…", "apiKey": "…"    // optional premium cloud; live ONLY in main
}
```

The network call runs in **main**; `apiKey`/`username` are **stripped from
`settings:get`** so they never reach the renderer. Unconfigured / disabled / any
error → `[]`, so a down checker can never break the editor. Text size limits +
per-request throttling (cloud free-tier) and quick-fix from `replacements` are
follow-ups.

**Built — M27 (real LSP):** `src/main/lsp.ts` is a minimal LSP client — main
spawns a language server, speaks JSON-RPC over its stdio (Content-Length framing,
`initialize`/`initialized`, full-sync `didOpen`/`didChange`, `workspace/
configuration` echo for ltex), and forwards the server's **push**
`publishDiagnostics` up to the renderer. LSP `Position`s are converted to editor
offsets in main (it mirrors each doc's text), and the mapped `GrammarMatch[]` are
pushed over a `lsp:diagnostics` channel to the renderer `createLspProvider`
(registered behind the facade next to spell + the HTTP checker). Config extends
the same `grammar` block — set `lsp.command` (the server argv) and it **supersedes
the HTTP `url`**; `ltex-ls` gives LanguageTool:

```jsonc
"grammar": {
  "enabled": true,
  "language": "en-US",
  "lsp": { "command": ["ltex-ls"] }   // or ["java","-jar",".../ltex-ls.jar"]
}
```

The server is spawned **lazily on the first sync** (which only happens while
diagnostics are on — nothing spawns when grammar is off), reused across edits,
restarted on a command change, and stopped on `will-quit`. Because it's push, a
live edit re-publishes without a per-edit request. Verified end-to-end against a
mock LSP server (a warning squiggle from a `publishDiagnostics` notification, no
orphaned child on quit). Still open: server crash/backoff UX, `codeAction`
quick-fixes, and surfacing config errors to the user.

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

**Built — M28 (MCP server):** `src/mcp/server.ts` is a standalone **stdio** MCP
server (MCP SDK 1.29) that **reuses the exact same StoryIndex** the app does —
`story-index.ts`/`fs-project.ts`/`frontmatter.ts`/`search.ts` are pure Node, so
there's no second implementation to drift. Run via `tsx` (no build step). It
exposes:

- **Resources** — every project `.md` file, listed + readable at `writer:///<rel>`.
- **Tools** (read-only unless noted): `project_overview`, `search_project`,
  `list_entities`, `find_references`, `definition_of` (resolves name/alias/`@{…}`),
  `mentions_in`, `thread_beats`, `reading_order` (manuscript scenes only, by
  `order`), `read_file`, and `write_file` (destructive; the path is guarded with
  the app's own `isInside(root, …)` so a client can't write outside the project).

The project root comes from `--root <dir>` (or `WRITER_PROJECT_ROOT`). Connect it
in Claude Desktop / Code:

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

Deterministic (no AI code / key / metered cost in the app — the LLM is the
client's). Verified end-to-end with a real MCP client: 10 tools + 27 resources
enumerated; `thread_beats "The Case"` returned the 6 ordered scenes; alias
resolution + `find_references` + the `write_file` root-guard all confirmed.
Follow-ups: MCP **prompts** (canned "summarise thread X"), a live app↔server sync
so edits reflect instantly, and richer edit tools (insert/replace a span vs whole
file).

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

## Export & compile ✅ (shipped)

Get the manuscript _out_. Two commands (menubar **Export ▾** or the palette):

- **Export Manuscript (Markdown)** — concatenates the ordered scenes into one
  clean `.md`.
- **Export to EPUB** — a valid EPUB (one chapter per scene, TOC, reading CSS).

The **strip-on-export contract** (once "TBD", now implemented in the pure
`src/shared/manuscript.ts`, unit-tested): remove frontmatter, `%% … %%` notes,
`{>> … <<}` comments, and `<!-- thread:x -->` markers; unwrap `{==span==}`
highlights and `@{surface}` mentions to their text; resolve CriticMarkup tracked
changes (accept by default). Deferred next: options UI (accept/reject, scene-title
headings), and more targets (`.docx` / PDF).

## Deferred (post-v1)

> Tabs/multiple editors and autosave **moved into Phase 6** (M13/M14) now that
> Phase 6 is the v1 line — they're part of "good enough," not post-v1.

- **Split view** — two editors side by side. Tabs (M13) come first; a split pane
  is the additional step beyond them.
- **Writing-experience polish** — typewriter / focus mode, word-count goals.
  (Dropped from Phase 6 to keep it scoped; nice-to-haves, not part of v1.)
- **Config format** — revisit TOML if hand-editing `project.json` gets clunky.
- **AI features** — `ContinuityProvider` (continuity/conflict detection) and
  thread inference. Split out from the deterministic core; same facade, LLM
  brain, main-process only. See [ai.md](./ai.md).
- **Inline table preview** — render a GFM table as a live `<table>` while writing
  (Obsidian-style: rendered when the cursor is away, source when it enters). The
  cheap _"Format Table"_ column-aligner already shipped; this is the WYSIWYG step
  (a CM block widget + cursor in/out toggle + editing/undo/wide-scroll handling).
- **Internationalisation (i18n)** — localize the app's own UI. Writing in any
  language already works (Unicode). Scaffold is cheap (a `t('key')` helper +
  per-locale JSON + a language setting); the cost is extracting hardcoded English
  across ~two dozen components, plus plurals/interpolation. RTL _UI_ layout
  mirroring is the one genuinely hard piece. (Also: per-language spellcheck
  dictionaries and CJK-aware word count.)
- **Real Neovim integration** — a "proper" Neovim like `vscode-neovim`: spawn a
  headless `nvim --embed` in the main process and talk msgpack-RPC, so the user's
  real config/plugins/registers/macros/ex-commands all work (vs. today's
  self-contained `@replit/codemirror-vim` _emulation_). The RPC transport is easy
  from Electron; the integration is not. **Heavy cons — assume a major refactor
  and dropping features:**
  - **External dependency** — requires Neovim installed on the user's machine.
  - **Approach A (embed the full nvim UI, Firenvim-style):** render nvim's grid
    directly → **CodeMirror is dropped for that buffer, and with it every prose
    decoration** — `@{mentions}`, `%% notes %%`, inline images, CriticMarkup,
    thread markers, the reading column. Guts the app's whole value for prose.
  - **Approach B (nvim engine + CM renderer, vscode-neovim-style):** keeps the
    decorations but means **rebuilding vscode-neovim's bidirectional buffer/mode
    sync from scratch** (no CM↔nvim library exists) — a multi-week/month effort
    with a long tail of subtle sync races (edit ownership, dot-repeat, macros
    mutating text, undo, mode transitions) and ongoing maintenance.
  - Either way it's a **major refactor of the editor layer**, not an add-on. Most
    realistic shape if pursued: an optional "raw Neovim mode" (A) a power user
    toggles, explicitly trading away the prose decorations — not the default
    writing surface.

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
