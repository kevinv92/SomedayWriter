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

### 1. A beat per scene, per thread

**What.** For each thread a scene sits on, one short, **writer-authored line
naming the thread's _move_ in that scene** — not a summary of the whole scene,
just what this arc does here. Think of it as a caption on the thread's dot.

**Why — use cases.**

- **Follow-a-thread becomes a living outline.** The braid can already reorder to a
  single thread's scenes; with beats, that view reads as an auto-synopsis of the
  arc. Reading _The Case_ top to bottom — "hired → finds the hiding place →
  smoke-rocket plan → the photo's spot is revealed → Irene has fled" — you feel
  escalation (or a sag) in five seconds without opening a scene.
- **Catch a stalled subplot.** Three near-identical beats in a row ("they argue",
  "another argument", "argue again") make repetition visible that's invisible when
  the scenes are forty pages apart.
- **Verify a payoff was set up.** Scan a thread's beats for the seed before the
  climax — "the photograph is introduced" appears before "the photograph is
  recovered." A Chekhov's-gun check, per arc.
- **Recall while navigating.** Hovering a dot in the braid shows "first real
  doubt" — you remember what that thread is doing there without opening the file.
- **See a scene pulling its weight.** A scene on three threads shows three beats;
  if one reads "mentioned in passing", that thread is weak there — cut it from the
  scene, or strengthen it.

**Example (the Scandal fixture).** Threads are declared in a scene's frontmatter
today as a `threads:` array — either a bare id, or an object `{ name, order }` for
an explicit per-thread beat order:

```yaml
# manuscript/act-2/03-briony-lodge.md — today
order: 30
threads: [the-case, the-woman]
```

Beats are additive — each membership gains a line; the bare-id form still works:

```yaml
# manuscript/act-2/03-briony-lodge.md — proposed
order: 30
threads:
  - name: the-case # 'name' is the existing object-form key (not 'thread')
    order: 3 # existing: this scene is beat #3 on the arc
    beat: 'Holmes scouts Briony Lodge and finds the hiding place'
  - name: the-woman
    beat: "first sight of Irene's cleverness"
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
key on the object form: `beat:` (this item), which pairs with `intensity:` from #5
below — the same annotation, two fields. Bare ids and `{ name, order }` keep
working untouched, so no project must adopt it. Inline `<!-- thread:x -->` markers
stay for _mid-scene_ scoping and carry no beat (for now).

**Open.** One beat per (scene, thread), or several (a scene that does two things to
one arc)? Where it renders — dot tooltip, lane caption, or a dedicated "arc
outline" list.

### 2. Story-time axis — track flashbacks & non-linear narrative

The braid's x-axis is **narrative order**; a writer mixing flashbacks /
flash-forwards / parallel timelines also needs **story-time** (when events happen,
vs when they're told). This shares the timeline surface but stands on its own — it
has its own design doc: **[story-timeline.md](./story-timeline.md)**. Design it
together with the braid so the two don't reinvent axis logic.

### 3. Pacing / gap signal

Flag when a thread has gone **silent** too long — N scenes or M words since its
last beat. A "Project Health"-style lint for **neglected arcs** (Chekhov's gun
left on the mantel). Ride the existing health/lint surface.

### 4. Word-weighted axis (toggle)

Scenes are equal-width columns today, so a 3,000-word scene and a 200-word aside
look identical. An optional mode sizes columns by scene length so the braid's
**shape reflects real pacing**.

### 5. Beat intensity → lane shape

Let a beat mark its role — `setup` / `rise` / `climax` / `fall` / `resolve` — and
drive the lane's height or colour from it. Now the braid **looks like a story's
shape** (rising action, convergence, denouement), not a flat dotted grid.

### 6. Explicit branch / merge (optional)

Branch/merge is currently _inferred_ from shared scene membership + dotted
verticals — clever and low-ceremony, but the reader of the diagram has to
reconstruct the topology. Consider an **optional** explicit relation on a
`type: thread` file (`branches-from:` / `merges-into:`) for cases where the
implicit form is ambiguous. Keep it optional so simple projects stay simple.

### 7. Make the list view earn its place

If the Timeline is the go-to, the **Threads list** should do what the timeline
can't: per-thread **stats** — scene count, word count, first/last appearance,
"silent for N scenes" — i.e. a dashboard, not a lesser duplicate.

---

## Data-model sketch (for discussion, not committed)

```yaml
# in a scene's frontmatter
order: 30 # narrative order (exists today)
when: 12 # NEW (#2): story-time sort key (flashback if < neighbours)
threads: # today: [the-case, the-disguise] OR [{ name, order }]
  - name: the-case # 'name' + optional 'order' is today's object form
    order: 1
    beat: 'Holmes is hired' # NEW (#1)
    intensity: setup # NEW (#5)
  - name: the-disguise
    beat: 'the groom disguise is chosen'
```

Every added key (`when`, `beat`, `intensity`) is optional and sparse; the bare-id
and `{ name, order }` forms keep working, so existing projects render unchanged.

## Open questions (roll up)

- How much lives in frontmatter vs. inline `<!-- thread:x -->` markers? (Keep both
  paths working; inline is for mid-scene scoping.)
- Does the **hierarchy `level`** work (see [todo index](./README.md)) interact
  with weighting/grouping here? Probably design them together.
- Is "story-time" big enough to be **its own view** rather than an axis mode of
  the braid? Start as an axis mode; split out if it grows.
- Migration: every addition must be sparse and optional so existing flat projects
  render unchanged.

## Related

- [story-model.md](../story-model.md) — current threads/braid model.
- [manuscript.md](../manuscript.md) — `order`, hierarchy, inline markers.
- [roadmap.md](../roadmap.md) — where a committed Threads v2 would slot in.
