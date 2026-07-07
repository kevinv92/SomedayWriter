# Decision history — writer-gui

Split out of [SPEC.md](SPEC.md) to keep the spec focused. Referenced there by
number (e.g. decision #45).

A running log of the choices behind this spec and _why_, so future changes don't
re-litigate settled ground. Newest at the bottom. (All dated 2026-07-05, the
initial design conversation.)

1. **Product shape** — Electron desktop app: file explorer on the left, editor on
   the right. _Why:_ familiar, trusted layout for a writing tool.
2. **A "Project" is a folder with a marker file** — the app treats a directory as
   a Project when a marker config sits at its root. _Why:_ plain files on disk,
   no database, no lock-in.
3. **Config format: JSON (`project.json`), not TOML** — _Why:_ native to JS, zero
   dependency, leaner to start. TOML kept as a possible later swap if
   hand-editing gets clunky.
4. **Single active editor in v1**, but modeled as a collection-of-one. _Why:_
   simplest useful thing now; split view / tabs stays additive, not a rewrite.
5. **Explicit save only (`Cmd/Ctrl+S`)** — _Why:_ predictable. Auto-save deferred
   and, when built, should be patch/diff-based.
6. **Explorer file ops in v1** — new file, new folder, rename, delete. _Why:_ it's
   a workspace, not just a viewer.
7. **Analysis is a pluggable provider/facade (LSP-shaped)** — the editor talks to
   one `AnalysisService`; intelligence is swappable providers. _Why:_ keeps the
   editor dumb and lets a real external LSP drop in later unchanged.
8. **Providers are TypeScript** (renderer / Web Worker / main as needed). Only a
   future external LSP server could be another language, reached via a TS adapter.
9. **Story features are deterministic, not AI** — character linking (find-refs,
   go-to-definition) and threads run off a project-wide `StoryIndex`. _Why:_ these
   are the differentiator and don't need an LLM to be reliable.
10. **Threads: file-level + inline markers, many-to-many, per-thread ordering.**
    A scene can sit on multiple threads; each thread can order its beats
    independently of manuscript order. Thread _identity_ is an optional
    `type: thread` entity file, not a `project.json` registry (decision #45).
11. **Thread visualiser is editable (two-way)** — a braid view where dragging
    reorders beats / changes membership and **writes tags back to the files**.
    _Why:_ also resolved decision #10's ordering — you drag instead of
    hand-typing order numbers.
12. **AI is split out and deferred** — continuity/conflict detection and thread
    _inference_ ride the same facade later, main-process only, opt-in. _Why:_ keep
    the deterministic core independent of any LLM.
13. **Diagnostics (squiggles) off by default**, with a toggle. _Why (writer
    feedback):_ squiggles fight drafting; prose isn't correct/incorrect. Pull
    features (completions/references) stay on.
14. **Export/compile acknowledged as a core need — TBD.** _Why:_ a writer must be
    able to get the manuscript out; scoped later (see Deferred).
15. **Editor: committed to CodeMirror 6.** Evaluated TipTap / Lexical (prose-model,
    built-in `@mention`, WYSIWYG) vs. CM6 / Monaco (text-model). _Why CM6:_
    keyboard-first product stance + real **Vim mode**, which prose-model editors
    lack; Monaco excluded as too IDE-feeling. Trade-off accepted: hand-roll the
    `@mention` UI on CM's completion API, and edit visible Markdown source rather
    than WYSIWYG.
16. **`EditorAdapter` seam added** so #15 stays reversible. _Why:_ switching within
    text-model editors is a few days; the only expensive move is crossing to a
    WYSIWYG document model (content re-serialization + losing Vim) — which the
    keyboard-first stance makes unlikely anyway. Markdown text is the canonical
    in-memory representation to keep the on-disk contract editor-independent.
17. **Scope: Markdown (`.md`) only in v1.** Editor, analysis, and story features
    target Markdown; other file types are out of scope (may show in the tree but
    aren't edited). _Why:_ one format keeps parsing, frontmatter, and the story
    model simple; prose is Markdown anyway.
18. **Near-essential requirements added: project-wide search/replace and
    scene reordering + manuscript order.** _Why:_ a writer would notice both
    missing on day one — finding/renaming across the book, and structuring scene
    order. Manuscript order is stored as sparse frontmatter `order`, edited by
    tree drag.
19. **Thread-visualiser _editing_ downgraded from requirement to stretch/at-risk.**
    _Why:_ tree-drag reordering (#18) already covers rearranging structure, so an
    editable braid is no longer load-bearing. The read-only braid stays a
    committed feature; drag-to-edit ships only if demand shows up. Trade
    considered: CodeMirror fully supports the prose **typography** goals (font,
    measure, line height, soft wrap, themes, focus-dimming via decorations;
    typewriter scrolling via a small custom extension), so the writing-experience
    bar isn't what's at risk — the braid-editing complexity is.
20. **Phase 1 built; `EditorAdapter` interface refined from the sketch.** CM6 is
    mounted behind the seam with Vim, prose typography (centered measure, serif,
    no gutter), a demo squiggle (crutch-word linter), and `@`-mention completion
    — all through the adapter, loading the sample-project fixture. Refinements vs.
    the original sketch: added `mount()`; `onChange` yields the new text and
    returns an unsubscribe fn; completions are a registered **`CompletionSource`**
    (pull) rather than a pushed `showCompletions` list — matching how editors and
    the future AnalysisService actually work. _Why:_ keep the seam faithful to
    real editor + analysis mechanics.
21. **Mentions use `@{surface}` (braced); names carry aliases; Markdown styled in
    source.** _Why:_ braces let a mention span multiple words and be stripped on
    export, so plain `@word` (space-terminated) isn't a limit; a character's
    canonical `name` + `aliases` all resolve to one entity, so full names and
    nicknames link too (plain-name detection is the natural prose path, `@{…}`
    the explicit one). Also: Markdown source is styled in place (big headings,
    real bold/italic, dimmed marks) for prose feel without leaving source mode.
22. **Inline notes via `%% … %%` (Obsidian-compatible).** Notes-to-self live in
    the source as dimmed asides, are excluded from word count, and are stripped
    on export. _Why:_ fits the plain-files, strip-on-export model (like `@{…}`) —
    no sidecar store. Margin/anchored (Google-Docs-style) comments considered but
    deferred as heavier (needs range-anchoring + a separate store).
23. **Phase 2 built; IPC contract, shared types, and a path guard added.** Real
    file I/O replaces the `?raw` sample import. Refinements vs. the Process/IPC
    sketch: `openProject()` bundles the folder dialog + config read into one call
    returning a **discriminated result** (`ok` / `cancelled` / `no-config` /
    `invalid-config`) instead of throwing across IPC; `readTree()` takes no
    argument and reads the main-held current project root rather than trusting a
    renderer-supplied path. IPC domain types (`ProjectMeta`, `TreeNode`,
    `ProjectConfig`, result unions) live in **`src/shared/`** (aliased `@shared`
    in the renderer) so main, preload, and renderer share one definition. Main
    keeps the open project's root and **guards every file op** so a renderer
    can't read/write outside it. Save is explicit `Cmd/Ctrl+S` via a
    renderer-level key listener (no editor-seam change); dirty state is derived
    by comparing live editor text to the last-saved baseline. Non-`.md` files
    show in the tree but are greyed/non-selectable (decision #17). _Why:_ keep
    the renderer untrusted and the seam intact while making failures data, not
    exceptions.
24. **`window.api` is a formal desktop-shell seam (Electron kept replaceable).**
    Electron isn't going away, but the renderer is deliberately shell-agnostic:
    it talks only to typed `window.api` methods, never to Electron/Node/`fs`/
    `ipcRenderer`; all shell code lives in `src/main` + `src/preload`; IPC
    payload types live in `src/shared` free of shell types. _Why:_ a future
    shell swap (e.g. Tauri, for smaller bundle/RAM) should touch only
    `src/main`/`src/preload`, leaving `src/renderer` intact. Decision now: **stay
    on Electron**; the cost of switching rises as main-process logic accumulates
    (Phase 5 `StoryIndex`, a future LSP subprocess), so reassess before Phase 5,
    not after. Recorded as a standard in AGENTS.md → _Keep seams intact_.
25. **Manuscript-order requirements pinned down (ahead of M6).** `order` lives in
    per-file frontmatter (sparse, step 10), scopes files **within a directory**,
    and is edited only by **drag** — dropping between siblings rewrites just that
    file's `order` (midpoint / `last + 10`), never moving the file on disk;
    dropping onto a folder is a **move** (`rename`) that carries `order` along.
    Write-back is non-destructive (only the `order` field changes); the `NN-`
    filename prefix is cosmetic and may diverge from `order`. Renormalize a
    folder only when a gap runs out. _Why:_ make M6 unambiguous and keep the
    single-file-write property that motivated sparse ordering (#18). Global
    cross-folder ordering and orderable folders are deferred (see _Deferred
    decisions_).
26. **Edit safety + save model settled.** Explicit `Cmd/Ctrl+S` stays the default
    (decision #5). _Near-term (Phase 3):_ switching or closing a file with unsaved
    changes **prompts** — never silently discards edits (fixes a data-loss gap in
    the current build). _Full model (Phase 6, M13/M14):_ **tabs** where each open
    doc is its own buffer that **retains** unsaved changes (per-tab dirty dot), so
    switching never writes and never loses work; **autosave** becomes an **opt-in**
    setting, patch-based, not the default. _Why:_ writers want control, predictable
    saves, and git-friendliness; per-tab buffers remove the data-loss risk without
    forcing autosave-to-disk.
27. **Phase 6 = the v1 "good enough" Major Milestone; search fleshed out
    VS-Code-style.** Search is four keyboard surfaces: in-document find
    (`Cmd/Ctrl+F`) + project-wide find/replace (`Cmd/Ctrl+Shift+F`) in **M5**;
    Quick Open fuzzy file finder (`Cmd/Ctrl+P`) + Command Palette
    (`Cmd/Ctrl+Shift+P`) in **Phase 6**, both on a central **command registry**
    that menus and keybindings also consume (a pluggability seam like
    `AnalysisService`). Tabs + autosave moved from _Deferred_ into Phase 6.
    _Why:_ palette + quick-open are the keyboard-first payoff that matches the
    product stance; the registry keeps commands/keybindings in one place; and
    Phase 6 is the natural line past which the app is usable daily.
28. **Two-tier config: app settings vs project config.** Per-project settings stay
    in `project.json` (in the folder, in the repo); **app/user** settings — recent
    projects, reopen-on-launch, window bounds, global editor prefs — live in a
    separate `settings.json` in the OS user-data dir (`app.getPath('userData')`),
    never inside a project. Main owns both; the renderer uses typed
    `getSettings`/`updateSettings`; project values override app defaults where
    they overlap; plain JSON, zero-dep (no `electron-store`). Introduced in Phase 6
    (M12, recent projects). _Why:_ recent projects and global prefs are inherently
    not project-scoped and must persist across projects and launches.
29. **Phase 4 built; analysis facade + a dictionary-free spell provider.** The
    `AnalysisService` (renderer) holds the provider registry, debounces, gates
    diagnostics on/off, and merges completions; the editor reaches it only
    through the existing `setDiagnostics`/`setCompletionSource` adapter methods,
    so the CM-only rule holds. The Phase 1 demo wiring is gone: `@`-mentions moved
    into a `mention` **provider**, and the crutch-word demo was replaced by a
    `spell` **provider** (common-misspellings map + repeated-word detection).
    _Why the lightweight spell check:_ a real Hunspell dictionary is ~1MB and
    Phase 4 is about proving the pluggable path, not shipping a dictionary — and
    a full `nspell`-in-main provider can register alongside later with **zero**
    facade changes (exactly the payoff of the design). Provider positions use
    **offsets**, not LSP line/char, matching the editor seam (refines the sketch,
    cf. #20).
30. **File titles are derived, not duplicated.** A file's display title resolves
    `frontmatter.title` → first `#` heading → prettified filename; a normal file
    declares no `title` (it just has the heading). _Why:_ declaring it in
    frontmatter as well duplicates the name three ways (filename + frontmatter +
    heading) and the copies drift. `StoryIndex` computes the one title so every
    consumer (tree, visualiser, inspector, export) agrees. Sample fixture
    de-duplicated to match.
31. **Inspector (file-details) pane — specced now, built with Phase 5 (M8b).** A
    togglable read-only pane mirroring what `StoryIndex` parsed for the current
    file (title source, order, threads, mentions, and — the point — frontmatter
    parse warnings), as a debugging aid for hand-edited frontmatter. _Why Phase 5:_
    it must read the same parsed model the app uses (never parse independently),
    and that model + full YAML frontmatter parsing arrive with `StoryIndex`.
    Confirms the shell is a multi-pane system (tree / editor / project-search /
    inspector / visualiser), with a resizable layout deferred to M12.
32. **Phase 6 rescoped from "Polish" to "Writing environment".** "Polish" read as
    an open-ended bucket; Phase 6 is now scoped to the concrete milestones already
    in it (tabs, autosave, quick-open + palette, unified search, panes / recent
    projects / keyboard nav + app-settings). Still the 🏁 v1 Major Milestone.
    Speculative writing-experience extras (typewriter / focus mode, word-count
    goals) moved to _Deferred (post-v1)_. _Why:_ a named, bounded phase is
    schedulable; a polish grab-bag isn't.
33. **Entity model is type-generic; extended types are Phase 7.** An entity is any
    profile file with a `type` (the discriminator already in the fixture). One
    `EntityProvider` parameterized by `type` links characters, locations, items,
    factions, magic systems… with `name` + `aliases` resolution and no per-type
    code. **v1 (Phase 5) ships `character` + threads**; the generic provider and
    more types land in **Phase 7**. Worldbuilding entities are referenceable pages
    (deterministic); enforcing a magic system's _rules_ against the prose is
    semantic and stays in the AI `ContinuityProvider` lane (deferred). _Why:_ the
    linking machinery was always entity-agnostic — hard-coding one provider per
    type would be needless duplication.
34. **Manuscript hierarchy = a folder-tree of units (scene → chapter → act);
    captured now, mostly deferred.** A unit is a file (leaf) or folder
    (container); nesting is general, not a fixed three levels; sequencing is
    depth-first + per-directory `order` (already built). **Level is implicit from
    tree depth**, with an optional per-file `level` override and a **folder marker
    file** (`index.md` or `_folder.md`) for folder-level metadata + child defaults
    — both **reserved, not implemented**; they only become load-bearing at
    export/compile. _Why capture now:_ so export, the binder, and the visualiser
    build on one agreed model without a rewrite, without over-building before it's
    needed. Marker file stays an explicit declaration (identity remains
    frontmatter-driven, not folder-name-driven — cf. the affirmed principle).
35. **Anchored comments via CriticMarkup (Phase 9) — resolves the deferred half of
    #22.** Comments attach to a span with CriticMarkup
    (`{==span==}{>>note<<}`), so they live inline in the `.md` (no sidecar store)
    and CodeMirror anchors them **for free** as the text shifts. Rendered with a
    decoration + `hoverTooltip` — the same toolbox as the lint squiggles. `%%…%%`
    stays the _unanchored_ note; `{>>…<<}` is the _anchored_ comment; both strip on
    export (the contract now also unwraps `{==…==}` highlights). Google-Docs
    margin/threads stays a possible later _display_ layer, not the foundation.
    CriticMarkup also opens a future tracked-changes lane (M25). _Why:_ inline
    marks dodge the anchor-drift + separate-store cost that made #22 defer this,
    and reuse decoration machinery the editor already has.
36. **External grammar/style tools plug in as providers (Phase 10, opt-in).** They
    ride the existing `AnalysisService` facade — a main-process provider calling
    the tool's API (or an `LspProvider`), mapping results → diagnostics, off by
    default, key in main, cloud use disclosed. First targets **LanguageTool**
    (open, self-hostable) and **ProWritingAid** (API); **Grammarly is out** — no
    third-party editor API. Ships _named_ integrations; a sandboxed user-plugin
    SDK is a bigger Deferred item. _Why:_ this is precisely what the pluggable
    analysis design was for — no editor/facade change.
37. **AI writing assistant (chat panel) — a separate AI surface, grounded in the
    model.** A conversational side pane, post-v1, its own later AI phase. Unlike
    `ContinuityProvider`/inference it is **not** an `AnalysisProvider` (chat, not
    diagnostics), but obeys the same rules (main-process key, opt-in, deterministic
    core independent). Its edge: context + **tools** from `StoryIndex`
    (find-references, mentions, order) so it reasons over the real structured
    project. Claude is the default model, provider-flexible. _Why:_ the deterministic
    prose "language server" is exactly the grounding a generic chatbot lacks.
38. **MCP server is the committed AI-integration path (Phase 11); in-app chat is
    optional/deferred.** A third-party app can't ride a user's Claude Pro/Max
    subscription (that OAuth is Anthropic-first-party only), so rather than embed a
    metered client, writer-gui **exposes an MCP server** — project files + the
    deterministic `StoryIndex` tools — and a subscription-authed client (Claude
    Code/Desktop) supplies the AI. **Locked in** because it's deterministic (no key,
    no AI code in-app), sidesteps API billing, and makes the grounded-in-the-model
    differentiator reusable by any MCP client. The embedded BYO-key chat panel
    stays a deferred convenience. _Supersedes the earlier "two equal paths" framing._
39. **Phase 6 (v1 Major Milestone) built — ahead of Phase 5.** Phases 5–6 don't
    depend on each other, so the writing environment shipped first: app-settings
    store + recent projects + resizable sidebar (M12), tabs with per-tab unsaved
    buffers (M13), opt-in autosave (M14), Quick Open + command palette on a
    command registry (M15), unified find UI (M16). Autosave is whole-file for now
    (patch-based deferred). **And the GUI is verifiable here after all** — an
    earlier session wrongly believed the sandbox couldn't run Electron; unsetting
    `ELECTRON_RUN_AS_NODE` launches it, and CDP (remote-debugging port) drives +
    screenshots it. Every M12–M16 milestone was visually verified this way.
    (M12 later completed: app-settings now reopens the last project + persists
    sidebar width, and tree keyboard-nav shipped.)
40. **Keyboard shortcuts: OS-standard first, via a native menu + a keybinding
    layer.** Prefer platform-standard accelerators (they differ per OS) so muscle
    memory transfers. Standard OS actions (Save, Close Tab, Quit, Edit menu, tab
    switching) come from an **Electron native menu using `role`s** — correct
    per-OS accelerators for free, and discoverable in the menu bar; app-specific
    commands (Quick Open, palette, focus explorer/editor) bind via the M15 command
    registry. _Not built yet_ (no custom menu today) — a remaining Phase 6
    refinement, which is why standard tab-switching / region-focus keys are
    currently absent. Also spec'd the honest gaps in "completed" phases: project
    replace is replace-all (per-match + regex are refinements), window-bounds
    persistence and a native menu remain.
41. **One command registry drives palette + shortcuts + menu; keybindings are
    user-overridable; the menu stays behind the shell seam.** The renderer owns a
    single registry (`{ id, title, category, defaultKeybinding, run }`); the
    palette and shortcuts read it, and the **native menu is generated** from it
    (renderer → main IPC; Electron `Menu` is the only shell-specific part, so a
    Tauri swap rewrites just the builder — cf. #24). Users remap via a
    `keybindings.json` in user-data; the registry merges default + override into
    the effective binding shown in palette + menu. Menu items use
    `registerAccelerator: false` so displayed shortcuts don't hijack keys from the
    renderer / CodeMirror. _Why:_ avoids the two-sources-of-truth trap (an ad-hoc
    palette array + a hardcoded menu list) and delivers customizable keys for
    free. Not built yet — supersedes the plain "command registry" sketch.
42. **Visual design system pulled ahead to Phase 8 (was Phase 11).** With Claude
    Design access authorized, the design-system + writer-comfort-theme work moves
    up to run right after Phase 7, shifting editorial marks → Phase 9, external
    analysis → Phase 10, MCP → Phase 11 (command system stays Phase 12). Downstream
    milestones renumbered to stay sequential (M17–M31). _Why:_ a coherent visual
    language pays off across every later phase, and it's now unblocked — no reason
    to let it trail the post-v1 feature phases.
43. **Phase 7 also gets frontmatter intellisense (M19) + new-file entity templates
    (M20).** Both hang off the M18 registered-entity-types schema: completion of
    attribute keys/values inside the YAML frontmatter (through the `AnalysisService`
    facade, using the existing frontmatter-line tagging), and a per-type file
    template on New File / palette ("New Character", …). _Why:_ once types are
    registered and schema'd, both are cheap, schema-driven, and per-type-code-free —
    they make hand-authoring profiles far less error-prone.
44. **Reference companion pane: auto-follow the scene, pin to freeze (M8d).** The
    writer's real need while drafting is a _glance_ at the bible (eye colour, a
    world rule, the motif), not another editing tab — tabs are single-focus and
    make you navigate away from the prose. So a right-side pane keeps references at
    hand. Crucially it **auto-follows the scene** (shows the entities detected in
    the current file — M8b's mention engine) rather than being a hand-curated pin
    list, because what a writer needs shifts every scene and a manual list goes
    stale; **pinning** is reserved for the 2–3 book-long anchors (antagonist, a
    `themes.md` note), persisted per project. Read-first (collapse-to-summary,
    "open full" → tab); the **cardinal rule** is that auto-follow may change list
    _membership_ but must **never move the entry the writer is currently reading**
    (debounced updates, per-entry scroll memory). A small resizable pane is right
    — the job is a short glance; long reads graduate to a tab. _Why:_ mirrors how a
    writer's attention actually moves ("who's in this scene" mostly, "hold this one
    thing" occasionally) and removes the pin-management busywork a pure pin list
    would impose. Named **Companion** to avoid colliding with the _References_
    (find-references) panel. Reuses the existing pane shell + mention engine, so
    it's small.
45. **Threads are `type: thread` entities; nothing thread-related in
    `project.json`.** `project.json` is **tool/editor configuration**; a thread's
    identity (name, colour, and a _description of the arc_) is **story content**,
    so it moves to an optional profile file — `threads/rebellion.md` with
    `type: thread` — like any other entity. Threads stay **zero-ceremony**: tagging
    `threads: [rebellion]` in scenes works with defaults, and the entity file is
    created only to name/colour/describe a thread. _Why:_ (1) keeps story data out
    of the tool-config file (the config type drops its dead `threads` registry);
    (2) a file can hold the arc's prose a JSON blob never could; (3) a thread then
    reuses the entire entity system — find-references (its scenes), go-to-definition,
    Companion, Inspector — with only the membership query (scan scene `threads:`
    frontmatter, not prose) staying thread-specific. Entity-_type_ registration
    (M18) is schema, not content, so it stays in `project.json`. _Refines the
    earlier "threads optionally registered in project.json" framing (#10)._
