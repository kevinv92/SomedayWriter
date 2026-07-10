# Threads v2 — from membership to movement

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _needs design_ (drafting the shape; nothing committed).

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
    order: 3 # existing: this scene is beat #3 on the arc
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

**Declaration & data.** This rides the **existing** `threads:` contract (see
[story-model.md](../story-model.md) → threads). The only change is one optional
key on the object form: **`summary:`** (this item), which pairs with `intensity:`
from #4 below — the same beat, annotated with two fields. Bare ids and
`{ name, order }` keep working untouched, so no project must adopt it. (Named
`summary`, **not** `beat`, on purpose: a _beat_ is the appearance/dot; the
`summary` is the line describing it.) Inline `<!-- thread:x -->` markers stay for
_mid-scene_ scoping and carry no summary (for now).

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

### 6. Make the list view earn its place

If the Timeline is the go-to, the **Threads list** (all threads) should do what
the timeline can't: per-thread **stats** — scene count, word count, first/last
appearance, "silent for N scenes" — i.e. a dashboard, not a lesser duplicate. The
_single_-thread version of this lives in #7.

### 7. Thread detail view — when a thread file is open

**The question:** when you open a `type: thread` file (`threads/the-case.md`),
should a dedicated view show that thread's beats?

**Yes — but as a contextual mode of the right pane, not a new always-on toggle.**
A thread's detail is only meaningful while a thread file is active, so surface it
the way the **Companion** (auto-follows the scene's entities) and **Inspector**
(shows the active file's parse) already do: the pane's content switches with the
active file. An always-present rail button that's disabled for every non-thread
file is clutter.

**What it shows** — all _derived_, scanned from scenes' `threads:` tags (the beats
live on the scenes, not in the thread file):

- the thread's **beats in order** (per-thread `order`, then narrative order), each
  a row — scene title · `summary` · `intensity` badge · click-to-jump;
- **arc stats** — beat count, word count across the arc, first/last appearance,
  "silent for N scenes" gaps (#6's dashboard, scoped to this one thread);
- the thread file's own prose (its identity/description) stays in the editor; the
  pane is the computed companion beside it.

**Zoom levels.** The braid (Threads · Timeline) is the **overview** — every thread
at once; this is the **drill-down** — one arc in depth. They pair: clicking a lane
in the braid opens that thread file → this view. Overview → detail.

**Alternative considered:** render the beats **inline in the editor**, below the
thread file's frontmatter (the file _is_ the thread's page). Rejected as the
default because the beats are **derived**, not file content — a read-only widget
inside an editable file is confusing. Possible later as a collapsed "arc" section
once the pane exists.

**Open:** reuse Inspector/Companion, or a sibling "Thread" mode? Can you edit a
`summary` from the pane (write back to the scene's frontmatter), or read-only v1?

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
threads: # today: [the-case, the-disguise] OR [{ name, order }]
  - name: the-case # 'name' + optional 'order' is today's object form
    order: 1
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

## Tasks (work-breakdown when this ships)

Not committed — this is the full surface area so nothing (**especially the docs
and help text**) is forgotten. Ship incrementally; each of #1–#8 can land alone.
Story-time / chronology is out of scope here — its tasks live in
[story-timeline.md](./story-timeline.md).

**Model & data (main / shared)**

- [ ] Extend `parseThreadTags` (`story-index.ts`) to read `summary`, `intensity`,
      and `state` on the object form; keep bare-id and `{ name, order }` working.
      (#1, #4, #5)
- [ ] Carry `summary`/`intensity` through `buildThreads` → the `story:threads` IPC
      and the shared `Thread`/beat types.
- [ ] Make per-scene **word count** available to the index (pacing + weighted
      axis). (#2, #3)

**Editor & panes (renderer)**

- [ ] Braid: hover a dot → show its `summary`; drive lane shape/colour from
      `intensity`; word-weighted-axis toggle. (#1, #3, #4)
- [ ] **Thread detail view** — contextual right-pane mode when a `type: thread`
      file is active (beats in order, stats, jump). (#7)
- [ ] Threads-list **stats dashboard**. (#6)
- [ ] Pacing/**gap lint** on the health surface ("silent for N scenes"). (#2)
- [ ] **Overview minimap + scrubber** below the braid — compressed render +
      draggable viewport with two-way scroll sync. (#8)
- [ ] Render lane start/end **caps** from `state` (opens/closes), and infer
      **branch/merge** from open/close co-occurrence in a scene. (#5)

**Frontmatter authoring**

- [ ] Intellisense (`frontmatter-provider` / `frontmatter-context`) offers
      `summary`, `intensity` (enum), and the `threads:` object keys.
- [ ] New-file templates (`entity-template`) + the entity-type registry know the
      new fields.
- [ ] Frontmatter help surfaces them — see [frontmatter-help.md](./frontmatter-help.md).

**Help & docs — do not skip**

- [ ] **Syntax reference** (the in-app Markdown & syntax cheat-sheet): add the
      expanded `threads:` shape, `summary`, `intensity`, and the two-`order` note.
- [ ] **In-app Help guide:** a line on per-beat summaries + the thread detail view.
- [ ] **README:** update the "Story intelligence" bullets (threads carry per-beat
      summaries; a thread detail view) and refresh the threads GIF/screenshot.
- [ ] **Spec:** flesh out `story-model.md` (threads) and confirm `manuscript.md`'s
      axes table; move the shipped parts of this doc from `todo/` into the relevant
      spec section, and close the item.

**Examples & tests**

- [ ] Add `summary`/`intensity` to a few Scandal scenes so the feature demos; keep
      `sample-project` minimal.
- [ ] Unit tests: extended `parseThreadTags` (parse + back-compat), beat build with
      summaries, gap/pacing computation.

**Decisions**

- [ ] Record in `DECISIONS.md`: the `summary`-not-`beat` field name, the per-thread
      `order` rename call, and the branch/merge model (`state` on the beat vs.
      thread-file edges).

## Open questions (roll up)

- **The two `order`s.** The per-thread `order` (inside a `threads:` entry) shares
  its name with the root manuscript `order`, but they're different axes — read
  order vs. position-on-this-thread (see the disambiguation in
  [manuscript.md](../manuscript.md) → "Three sequencing axes"). Do we **rename the
  per-thread one** (e.g. `pos` / `beat-order`) to kill the collision, or rely on
  scope + docs? Root `order` is entrenched (readOrder, tree, export, MCP) — it
  stays; the nested one is the rename candidate. Decide when Threads v2 is
  committed. (If renamed, keep reading the old `order` key for back-compat.)
- How much lives in frontmatter vs. inline `<!-- thread:x -->` markers? (Keep both
  paths working; inline is for mid-scene scoping.)
- Does the **hierarchy `level`** work (see [todo index](./README.md)) interact
  with weighting/grouping here? Probably design them together.
- Migration: every addition must be sparse and optional so existing flat projects
  render unchanged.

## Related

- [story-model.md](../story-model.md) — current threads/braid model.
- [manuscript.md](../manuscript.md) — `order`, hierarchy, inline markers.
- [story-timeline.md](./story-timeline.md) — story-time / chronology (the moved #2).
- [roadmap.md](../roadmap.md) — where a committed Threads v2 would slot in.

```

```
