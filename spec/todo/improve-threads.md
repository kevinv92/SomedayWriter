# Threads v2 — from membership to movement

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _in progress_ — **Foundations + Slice A (`summary`) + Slice B (`state`
lifecycle & branch/merge) shipped** (beat data model, braid hover summary, open/
close caps, inferred branch/merge connectors, Scandal example, tests). #2–#4, #6–#8
still design-drafting. See the Tasks section for what's checked off.

**Intent.** Today's threads model is structurally excellent but the _views_ show
where a thread **is**, not how it **moves**. This doc collects the gap and the
proposed next steps so Threads v2 can be designed as a whole rather than bolted on
piecemeal. Feature background lives in
[story-model.md](../story-model.md) → threads / braid.

---

## What already works (keep it)

- Threads are `type: thread` **entity files** (not a hidden registry), so they're
  first-class, `@{}`-mentionable, and versioned as plain files.
- A scene can belong to **multiple threads** (`threads:` frontmatter) — plot is
  concurrent, and the model reflects that. This is the best decision here; don't
  regress it.
- Two views: a **Threads list** and the **Threads · Timeline** braid (one lane per
  thread, scenes across the top, dots at membership, dotted per-scene verticals,
  and an order toggle: manuscript order ↔ follow-a-thread).
- "Follow a thread" reorder is the sleeper feature — reading one arc's beats in
  sequence is how you feel escalation.

## The core problem: presence, not movement

A dot says _"thread X appears in scene Y."_ It doesn't say **what happened to the
thread there** — advanced? stalled? complicated? paid off? The braid is a table
of contents, not a story. Everything below is about closing that gap.

---

## Proposed improvements

Roughly in writer-value order. Each is a candidate; not all need to ship together.

> **Out of scope here:** _story-time / chronology_ (flashbacks, flash-forwards,
> non-linear narrative) is **not** a threads improvement — it's its own feature
> with its own doc, [story-timeline.md](./story-timeline.md). It shares the
> timeline _surface_ (design the two together so they don't reinvent axis logic),
> but it is **not scoped into Threads v2** and adds no fields here.

### 1. A one-line summary for each beat

**First, what a "beat" _is_ (existing term).** In the thread model a **beat** is a
scene's **appearance on a thread** — one dot on that thread's lane. A thread is an
ordered run of beats (the per-thread `order` sequences them; `buildThreads` already
calls them `beats`). A scene on three threads _is_ three beats. This is not new.

**What's missing — and what this adds.** Today a beat is only a _dot_: it says the
thread is present in the scene, nothing more. This adds **a one-line `summary` to
each beat** — a short, writer-authored line naming what that arc _does_ there
("Holmes is hired", "first real doubt"). It's a caption on the dot, not a summary
of the whole scene. That single line is what turns the braid from a map into a
readable story; every use case below is unlocked by it.

**Why — use cases (all follow from giving each beat a summary).**

- **Follow-a-thread becomes a living outline.** The braid can already reorder to a
  single thread's beats; with summaries, that view reads as an auto-synopsis of the
  arc. Reading _The Case_ top to bottom — "hired → finds the hiding place →
  smoke-rocket plan → the photo's spot is revealed → Irene has fled" — you feel
  escalation (or a sag) in five seconds without opening a scene.
- **Catch a stalled subplot.** Three near-identical summaries in a row ("they
  argue", "another argument", "argue again") make repetition visible that's
  invisible when the scenes are forty pages apart.
- **Verify a payoff was set up.** Scan an arc's summaries for the seed before the
  climax — "the photograph is introduced" appears before "the photograph is
  recovered." A Chekhov's-gun check, per arc.
- **Recall while navigating.** Hovering a dot in the braid shows "first real
  doubt" — you remember what that thread is doing there without opening the file.
- **See a scene pulling its weight.** A scene on three threads shows three
  summaries; if one reads "mentioned in passing", that thread is weak there — cut
  it from the scene, or strengthen it.

**Example (the Scandal fixture).** Threads are declared in a scene's frontmatter
today as a `threads:` array — either a bare id, or an object `{ name, order }` for
an explicit per-thread beat order:

```yaml
# manuscript/act-2/03-briony-lodge.md — today
order: 30
threads: [the-case, the-woman]
```

Summaries are additive — each beat (membership) gains a `summary`; the bare-id
form still works:

```yaml
# manuscript/act-2/03-briony-lodge.md — proposed
order: 30
threads:
  - name: the-case # 'name' is the existing object-form key (not 'thread')
    pos: 3 # this scene is beat #3 on the arc — renamed from 'order' (see below)
    summary: 'Holmes scouts Briony Lodge and finds the hiding place'
  - name: the-woman
    summary: "first sight of Irene's cleverness"
```

The follow-thread view of _The Case_ then reads as an outline:

```text
The Case
  1. The King of Bohemia  — Holmes is hired to recover the photograph
  2. Briony Lodge         — scouts the house; finds the hiding place
  3. The Plan             — the smoke-rocket plan is set
  4. The Alarm of Fire    — the photograph's hiding spot is revealed
  5. The Empty Nest       — Irene has fled; the case is lost but resolved
```

**Declaration & data.** This rides the `threads:` contract (see
[story-model.md](../story-model.md) → threads). It adds one optional key to the
object form: **`summary:`** (this item), which pairs with `intensity:` from #4 —
the same beat, annotated with two fields. Bare ids and the object form keep
working, so no project must adopt it. (Named `summary`, **not** `beat`, on purpose:
a _beat_ is the appearance/dot; the `summary` is the line describing it.) Inline
`<!-- thread:x -->` markers stay for scoping a thread to a **passage within** a
scene and carry no summary (for now) — see the decision below. Note the object
form's per-thread order key is **`pos`** here, renamed from `order` (decision
below).

**Open.** One `summary` per beat, or can a beat carry a couple (a scene that does
two distinct things to one arc)? Where it renders — dot tooltip, lane caption, or
a dedicated "arc outline" list.

### 2. Pacing / gap signal

Flag when a thread has gone **silent** too long — N scenes or M words since its
last beat — so a **neglected arc** (Chekhov's gun left on the mantel, a subplot
that quietly died) doesn't slip by.

**In the UI — it lives in the Project Health panel.** This is a lint, so it
belongs with the existing health checks (dead references), not as a new surface.
A row per neglected arc, click-to-jump to the thread's last beat:

```text
Project Health
  Dead references (0)
  Neglected threads (2)
    ⚠ The Disguise — silent 6 scenes / ~4,200 words since “the plan”   → jump
    ⚠ The Ring     — opened, never closed (dangling)                    → jump
```

Rides the same plumbing as the dead-reference scan (`story:health`). Optionally a
small ⚠ badge on the lane in the braid where the gap opens. Thresholds
(scenes/words) are settings; "opened but never closed" reuses #5's `state`.

### 3. Word-weighted axis (toggle)

Scenes are equal-width columns today, so a 3,000-word scene and a 200-word aside
look identical. An optional mode sizes each column's **width by the scene's word
count**, so the braid's horizontal rhythm mirrors where the manuscript actually
spends words.

**In the UI.** A spacing toggle in the timeline's control bar, beside the existing
order toggle — it doesn't reorder, only rescales the x-axis.

```text
Even (today):
Order: Manuscript        Spacing: [Even]  By length
           Ch1    Ch2    Ch3    Ch4    Ch5
The Case   ●──────●──────●──────●──────●
The Woman  ●──────┼──────●──────┼──────●
          (420)  (380) (3,000) (210) (1,850)   ← words

By length (proposed):
Order: Manuscript        Spacing:  Even  [By length]
          Ch1 Ch2  Ch3                      Ch4  Ch5
The Case  ●───●────●────────────────────────●────●
The Woman ●───●────●────────────────────────┼────●
         420 380  3,000                     210  1,850
```

The fat middle (Ch3) now _looks_ fat and thin beats compress — so a **saggy
middle** or a **rushed climax** (a payoff sitting in a sliver of a column) shows
at a glance. Faint per-column word counts (toggleable), exact on hover. Reuses the
scenes' existing positions — only x-spacing changes, so it's cheap. Pairs with #4
(intensity → lane _height_): width = page-time, height = intensity.

### 4. Beat intensity → lane shape

Let a beat mark its role — `setup` / `rise` / `climax` / `fall` / `resolve` — and
drive the lane's height or colour from it. Now the braid **looks like a story's
shape** (rising action, convergence, denouement), not a flat dotted grid.

### 5. Thread lifecycle — `state: opens | closes | touches`

Branch/merge shouldn't need edges on the thread file. Make it a per-beat attribute
on the **thread declaration in the scene** — the same object that already holds
`name` / `order` / `summary`:

```yaml
threads:
  - name: the-disguise
    state: opens # this scene starts (or branches off) the thread
    summary: 'the groom disguise is chosen'
  - name: the-case # no state → 'touches' (a normal mid-thread beat)
    summary: 'Holmes scouts the house'
```

- **`touches`** _(default — omit it)_ — a normal beat; the thread passes through.
- **`opens`** — the thread's **first** beat: it begins, or splits off, here.
- **`closes`** — the thread's **last** beat: it resolves / ends here.

**Why this beats `branches-from:` / `merges-into:`.**

- **Local & discoverable.** You mark the lifecycle _where it happens_ — on the
  scene, beside that beat's `summary` — not in a separate thread file you must
  remember to edit.
- **Branch & merge fall out for free.** The braid reads topology from
  co-occurrence: a thread that **`opens`** in a scene where another is present →
  **branches** off it; two threads that **`close`** where a third **`opens`** →
  **merge** into it. No explicit edges, no thread-to-thread pointers to keep in
  sync.
- **Lanes gain real ends.** The braid caps a lane at its `opens`/`closes` beats
  instead of letting it float; and #2's gap lint can flag a thread that **opened
  but never closed** (a dangling arc).

**Open.** Can a thread legitimately `open`/`close` more than once (re-opening a
resolved arc)? Is `state` enough to render branch/merge unambiguously, or do
genuinely tangled books still want an explicit pointer as an escape hatch?

### 6. A full "Threads" dashboard (all threads)

The **Threads list** should do what the timeline can't: per-thread **stats** —
scene count, word count, first/last appearance, "silent for N scenes", open/closed
`state` — a dashboard, not a lesser duplicate of the braid.

**How it's rendered — a main-pane view, not a modal.** It's a **destination**, so
give it the whole centre pane: render it in `<main>` **in place of the editor**,
the same class as `BraidView` (Threads · Timeline) and the read-only `ImageView` —
the centre already swaps editor ↔ braid ↔ image (App's `<main>`). **Not** a modal
floating over the editor, and **not** a cramped right-side panel. Your open file
stays in its tab and comes back when you switch away.

Cleanest shape: make the **list and the braid two _modes_ of one "Threads" view** —
a `Timeline | List` toggle in that view's header — since both are read-only
renderings over the same thread model. (Two sibling main-pane views also work; one
view with a mode switch just avoids duplicate open/close plumbing.)

**Not to be confused with #7.** #6 is a full-pane, all-threads **destination** (you
navigate _to_ it). #7 is a right-pane **companion** that appears _beside the
editor_ when a single `type: thread` file is open. Different surfaces, different
jobs — but they can share the row/stat components.

### 7. Thread detail — the Companion pane in "thread mode"

When you open a `type: thread` file (`threads/the-case.md`), the **Companion pane**
shows **that thread's detail** in place of its usual contents.

The Companion is already the app's **per-file, context-following** pane — for a
scene it auto-follows the entities in view (with pin-to-freeze). A thread file is
just another active file, so the pane adapts: when the active file's `type` is
`thread`, it swaps the entity list for the thread's **beats**. No new pane, no
always-on rail toggle that's dead for every other file.

This is the first case of a more general idea — **a Companion that changes with
the entity you're viewing** — written up in
[companion-by-type.md](./companion-by-type.md).

**What it shows** — all _derived_, scanned from scenes' `threads:` tags (the beats
live on the scenes, not in the thread file):

- the thread's **beats in order** (per-thread `order`, then narrative order), each
  a row — scene title · `summary` · `intensity` badge · `state` cap · click-to-jump;
- **arc stats** — beat count, word count across the arc, first/last appearance,
  "silent for N scenes" gaps (#6's dashboard, scoped to this one thread);
- the thread file's own prose (its identity/description) stays in the **editor**;
  the Companion is the computed detail beside it.

**Zoom levels.** The braid (Threads · Timeline) is the **overview** — every thread
at once; the Companion here is the **drill-down** — one arc in depth. They pair:
clicking a lane in the braid opens that thread file → the Companion fills.

**Alternative considered:** render the beats **inline in the editor**, below the
thread file's frontmatter (the file _is_ the thread's page). Rejected as the
default because the beats are **derived**, not file content — a read-only widget
inside an editable file is confusing. Possible later as a collapsed "arc" section.

**Open:** can you edit a `summary` from the Companion (write it back to the scene's
frontmatter), or read-only v1? Answer: Read only

### 8. Overview minimap & scrubber — navigate a big braid

**The problem these very improvements create.** Summaries, intensity height,
word-weighted columns, more threads — the braid gets **big**. It scrolls both ways
(every scene across, every thread down) and it's easy to lose your place. It needs
a fast way to move around.

**The idea (a VS Code-style minimap / a video scrubber).** A thin, always-visible
**overview strip below the braid**: the _whole_ manuscript compressed to a glance,
with a **draggable viewport window** marking what's currently on screen. Drag or
click to scrub anywhere instantly.

```text
┌ Threads · Timeline ────────────── (main view, a window on a big braid) ┐
│  The Case   ●────●─────────●        ...                                 │
│  The Woman  ●────┼─────────●        ...                                 │
└─────────────────────────────────────────────────────────────────────────┘
 Overview (whole book, ~1:20):   ▁▂▅▇▆▃▁▁▂▄██▆▃▁▁▂▃▂▁▁▂▅▇▅▂▁
                                      └ viewport ┘  ← drag / click to scrub
```

**What the overview shows** — the braid's _shape_ at a fraction of scale: lanes as
thin coloured lines, beats as tiny marks; the pacing shape carried down (intensity
as height, word-weighting as spacing) so the minimap reads like the story's
silhouette; act/chapter boundaries as faint ticks; and the **viewport rectangle**
= what's on screen.

**Interaction.** Drag the viewport (or click a spot) → the main braid pans there;
scroll the main view → the viewport tracks (two-way sync); hover → a peek tooltip.

**Why a minimap, not just scrollbars.** A scrollbar says _where_ you are; a
minimap says _what's there_ — you navigate by the story's shape ("jump to the
dense climax cluster"), which is exactly the value the other improvements add.

**Open.** Does it get too dense to help on a 200-scene epic (a fit/zoom control)?
Should it just _be_ the word-weighted pacing chart (#3) rather than a separate
strip? Horizontal-only, or a 2-D mini-braid when the lane count is also tall?

---

## Data-model sketch (for discussion, not committed)

```yaml
# in a scene's frontmatter
order: 30 # narrative order (exists today)
threads: # bare id OR object form { name, pos?, … }
  - name: the-case
    pos: 1 # per-thread order — RENAMED from 'order' (see decisions)
    summary: 'Holmes is hired' # NEW (#1) — the beat's one-line summary
    intensity: setup # NEW (#4)
  - name: the-disguise
    state: opens # NEW (#5) — opens | closes | touches (default touches)
    summary: 'the groom disguise is chosen'
```

Every added key (`summary`, `intensity`, `state`) is optional and sparse; the
bare-id and `{ name, order }` forms keep working, so existing projects render
unchanged. (Terminology: a **beat** is a scene's appearance on a thread; `summary`,
`intensity`, and `state` are fields _on_ a beat — see #1 and #5.) Story-time
(`when:`) is a **separate feature** — see [story-timeline.md](./story-timeline.md).

## Tasks

Concrete plan for the **decided** design. Everything builds on one **Foundations**
step, then ships in independent **slices** — each end-to-end (data → UI →
authoring → help/docs → tests). Items still needing a design pass are marked
**⛬ needs design** and aren't ready to task. Story-time / chronology is out of
scope — its tasks live in [story-timeline.md](./story-timeline.md).

### Foundations — the beat data model (blocks the rest)

- [x] **Shared types** (`src/shared/types.ts`): `summary` / `intensity` /
      `state` (+ `ThreadIntensity`, `ThreadState`) on `ThreadBeat`. ✅ `9f92a08`→
- [x] **Parse** (`parseThreadTags`, `src/main/story-index.ts`): renamed the
      per-thread `order` key → `pos` (clean break); reads `summary` / `intensity`
      / `state`; defaults `state` → `touches`; drops unknown enums; bare-id form
      kept. Exported for tests. ✅
- [x] **Build** (`buildThreads`): attaches the three fields to each beat; rides
      the existing `story:threads` IPC. ✅
- [ ] **Per-scene word count** into the index (reuse the shared `countWords` over
      the scene body) — needed by the gap lint (#2) and weighted axis (#3). _(not
      needed for Slice A; do with #2/#3.)_
- [x] **Tests** (`src/main/story-index.test.ts`): `parseThreadTags` — each field,
      `pos`-not-`order`, enum-invalid dropped, `state` default, back-compat. ✅

### Slice A — `summary` [#1] · _shipped (core)_

- [x] Braid: hover a beat dot → its `summary` in the node tooltip
      (`Title — summary`). ✅ (CDP-verified on the Scandal the-case arc.)
- [x] Help & docs: syntax reference (in-app Help) gains the `{ name, summary }`
      form; README "Story intelligence" bullet. ✅
- [x] Example: `summary` added to the-case across five Scandal scenes. ✅
- [ ] **Follow-up:** intellisense (`frontmatter-provider`/`-context`) offering
      `summary`/`pos`/`intensity`/`state` inside a `threads:` object, + templates
      (`entity-template`) — a bigger change (nested-object completion); ships next.
- [ ] **Follow-up:** a dedicated "arc outline" list rendering (beyond the hover)
      lands with the Companion thread-mode (#7) / dashboard (#6).

### Slice B — `state` lifecycle + branch/merge [#5] · _shipped_

- [x] Braid: **cap rings** on `opens` (dashed) / `closes` (solid) beats. ✅
- [x] `inferThreadLinks` (`lib/thread-links.ts`) derives **branch/merge** from
      open/close co-occurrence; braid renders solid coloured connectors (merge
      dashed). ✅ CDP-verified on Scandal (the-disguise branches; the-woman +
      the-case merge into the-outwitting).
- [x] Help: `state` enum in the in-app syntax reference. ✅ _(intellisense /
      frontmatter-help still the shared nested-object follow-up from Slice A.)_
- [x] Example: `opens`/`closes` on Scandal (the-woman/the-case open, the-disguise
      branch, the merge at the Empty Nest). ✅
- [x] Tests: `inferThreadLinks` (branch, merge, lone-close, merge-beats-branch). ✅

### Slice C — pacing / gap lint [#2]

- [ ] Compute per-thread gaps (scenes + words since last beat) and "opened, never
      closed" (uses `state`); thresholds are settings.
- [ ] Surface in the **Project Health** panel as a "Neglected threads" section
      (rows, click-to-jump) via `story:health`; optional ⚠ badge on the braid lane.
- [ ] Tests: gap computation + dangling-thread detection.

### Slice D — Companion thread-mode [#7] · _first case of [companion-by-type.md](./companion-by-type.md)_

- [ ] Companion renders **thread detail** when the active file is `type: thread`
      (beats in order — title · `summary` · `intensity` · `state` · jump — plus arc
      stats). Introduce the minimal `type → view` switch here.
- [ ] Help/docs: note the Companion adapts to a thread file.
- ⛬ needs design: edit a `summary` from the pane, or read-only v1?

### Slice E — Threads dashboard [#6]

- [ ] New **main-pane view** (same class as `BraidView`, swaps the editor in
      `<main>`); ideally `Timeline | List` modes of one Threads view.
- [ ] Per-thread stats table (count, words, first/last, gaps, open/closed).

### Not ready — needs a design pass first

- ⛬ **#4 intensity → lane shape** — authoring is trivial (an enum), but the
  _visual_ mapping (lane height? colour ramp? both?) needs a design pass.
- ⛬ **#3 word-weighted axis** — a spacing toggle + column width ∝ word count
  (Foundations supplies the counts); pin down the even↔weighted interaction.
- ⛬ **#8 minimap / scrubber** — density, a fit/zoom control, and 2-D vs horizontal
  are open (see #8 above).

### On landing (every slice)

- [ ] Move the shipped part out of this `todo/` doc into `story-model.md`; keep
      `manuscript.md`'s axes table honest.
- [ ] `DECISIONS.md` entries as they settle: `summary`-not-`beat`, the per-thread
      `order` → `pos` rename, and the `state`-based branch/merge model.

## Questions — decided & still open

**Decided.**

- **The two `order`s → rename the per-thread one to `pos`.** Root `order`
  (narrative/reading order) is entrenched — `readOrder`, tree sort, export, MCP —
  so it stays. The per-thread order becomes **`pos`** (a beat's position on _this_
  thread), ending the name collision (see
  [manuscript.md](../manuscript.md) → "Three sequencing axes"). We're in
  **preview**, so it's a **clean break** — parsing drops the old nested `order`
  key rather than reading both.
- **Keep both authoring paths.** Frontmatter `threads:` declares **whole-file**
  membership; inline `<!-- thread:x -->` markers scope a thread to a **passage
  within** a scene — important when a thread runs through _part_ of a file, not the
  whole thing. Both stay; they do different jobs. (Inline markers carry no beat
  fields for now.)

**Still open.**

- Does the **hierarchy `level`** work (see [todo index](./README.md)) interact
  with weighting/grouping here? Probably design them together. _(left open)_
- The new beat fields (`summary` / `intensity` / `state`) stay **sparse &
  optional** so untagged projects render unchanged; the `order` → `pos` rename is
  the one break we take while in preview.

## Related

- [story-model.md](../story-model.md) — current threads/braid model.
- [manuscript.md](../manuscript.md) — `order`, hierarchy, inline markers.
- [story-timeline.md](./story-timeline.md) — story-time / chronology (the moved #2).
- [roadmap.md](../roadmap.md) — where a committed Threads v2 would slot in.
