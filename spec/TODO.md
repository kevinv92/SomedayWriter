# Design TODO — specs to write

_Part of the [SomedayWriter spec](./README.md)._

This tracks **design work owed**: areas that need a spec written or expanded
_before_ they're built. It's deliberately separate from the two neighbours:

- [roadmap.md](./roadmap.md) is the **feature backlog** — what to build and in
  what order.
- [../DECISIONS.md](../DECISIONS.md) is the **record of decisions already made**.
- This file is the **open design questions** — things where the _how_ isn't
  settled yet, so coding would be premature.

## How to use this

- Add an entry when a feature needs real design before implementation.
- Give it a **status** (`needs design` → `drafting` → `ready to build`), a
  one-line **intent**, and the concrete **open questions**.
- When its design lands (a new section here or in another `spec/*.md`, plus a
  numbered entry in `DECISIONS.md`), link it and close the item.

---

## Open design work

### Phase 12 — command & keybinding system · _needs design_

**Intent:** one command registry that the palette, menus, and keybindings all
draw from, with **user-overridable** shortcuts.

**Open questions:**

- Registry shape — is it the existing `useCommands` list promoted to a typed
  registry, or a new structure? How do commands declare default keys, context
  (editor vs global), and enablement?
- Keybinding overrides — schema in `settings.json` (or a dedicated
  `keybindings.json`?), conflict detection, and how a user discovers/edits them.
- **Native macOS menu vs the custom web menubar** — the one still-unresolved UI
  call (flagged in the icon/menubar review). A native `Menu` gets us the real
  system menu bar + OS shortcut handling, but splits menu definitions across
  main/renderer; the web menubar keeps everything in React. Decide before M29.
- Which existing shortcuts become rebindable vs. fixed (e.g. `⌘S`, `⌘P`).

**Related:** [roadmap.md](./roadmap.md) Phase 12 (M29–M31),
[navigation.md](./navigation.md).

### Export — options UI & more formats · _needs design_

**Intent:** grow export past the shipped Markdown/EPUB into a configurable,
multi-format compile.

**Open questions:**

- Options surface — a dialog or a config block? Which knobs: accept vs. reject
  tracked changes, scene-title headings, scene separators, front matter / title
  page, which files to include.
- New targets — `.docx` (writers' lingua franca) and PDF. Library vs. Pandoc vs.
  hand-rolled. Styling/theming of the output.
- Does export consume the manuscript **hierarchy** (see next item) for heading
  levels / part breaks / EPUB nav, or stay flat-by-`order`?

**Related:** the shipped pipeline (`src/shared/manuscript.ts`, `src/main/epub.ts`),
[manuscript.md](./manuscript.md), [roadmap.md](./roadmap.md) "Export & compile".

### Manuscript hierarchy — explicit `level` field · _needs design_

**Intent:** promote the implicit scene→chapter→act nesting to an explicit,
addressable structure.

**Open questions:** where `level` lives (frontmatter? derived from folder depth?),
how it maps to export heading levels and the braid's grouping, and the migration
for existing flat projects. Becomes load-bearing the moment export or a binder
needs part breaks.

**Related:** [manuscript.md](./manuscript.md) → hierarchy section.

### AI continuity (`ContinuityProvider`) · _needs design_

**Intent:** the deferred-AI lane — continuity/conflict detection and thread
inference, riding the analysis facade, main-process only, opt-in.

**Open questions:** what "continuity" concretely flags (timeline, character
detail, place drift?), how it's grounded in the StoryIndex, prompt/response
shape, cost/latency and when it runs, and how results render (diagnostics vs. a
dedicated panel). Deterministic core stays AI-free; this is a provider.

**Related:** [ai.md](./ai.md), [analysis.md](./analysis.md).

### Distribution & updates · _needs design_

**Intent:** make the app installable by non-developers without friction.

**Open questions:** Developer-ID **signing + notarization** (certs as CI secrets,
electron-builder config), whether to ship **auto-update** (electron-updater +
the `latest-mac.yml` the release step would need), and cross-arch/universal +
Windows/Linux targets. Today's DMG is unsigned and arm64-only.

**Related:** [roadmap.md](./roadmap.md), `.github/workflows/release.yml`.

### Smaller open questions

- **Inline table WYSIWYG preview** — a CM block widget rendering a GFM table
  while the cursor is away, source when it enters (edit/undo/wide-scroll handling
  is the hard part). The column-aligner ("Format Table") already shipped.
- **i18n** — a `t()` + per-locale JSON scaffold is cheap; the cost is extracting
  hardcoded English across the components, plus plurals and RTL UI mirroring.
- **Real Neovim integration** — an optional "raw Neovim mode" (embed `nvim`);
  heavy, trades away prose decorations. See the deferred note in
  [roadmap.md](./roadmap.md).

---

## Template

```md
### <Title> · _needs design | drafting | ready to build_

**Intent:** one line — what it's for.

**Open questions:**

- ...

**Related:** links to roadmap.md / other spec files / DECISIONS.md.
```
