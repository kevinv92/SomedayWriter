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

Let a scene say, for each thread it's on, **one line of what that thread does
there** ("first real doubt", "the lie is planted", "payoff"). Surface it on hover
in the braid and in the follow-thread reading order.

- **Data:** extend `threads:` from a list of ids to a list of `{ thread, beat }`,
  _or_ carry it on the inline `<!-- thread:x -->` marker. Must stay
  hand-editable and degrade to the current bare-id form.
- **Open:** one beat per (scene, thread) or several? Where it renders (tooltip,
  lane label, a side list).

### 2. Story-time axis — track flashbacks & non-linear narrative

The braid's x-axis is **narrative order** (the order the reader meets scenes).
That's only half the picture: a writer mixing **flashbacks / flash-forwards /
parallel timelines** also needs **story-time** — _when things actually happen in
the world_. Right now that lives only in the writer's head, and it's exactly what
gets hard to track.

Proposal: give each scene an optional **story-time** value and let the timeline be
ordered by it.

- **Data:** a scene frontmatter field — a `when:` value. Options to decide
  between: an abstract **chrono order** number (like `order`, but story-time), a
  real/approx **date**, or a named **era/label** (`when: "Before the war"`).
  Sparse — scenes without it fall back to narrative order.
- **Views it unlocks:**
  - **Chronology ordering** — a third axis mode next to _manuscript_ and
    _follow-thread_: lay scenes out by `when`, so the true sequence of events is
    visible independent of how they're told.
  - **Told-vs-happened plot** (the powerful one) — a small 2-D chart: x =
    narrative order, y = story-time. A linear story is a diagonal; **every
    flashback is a visible dip, every flash-forward a spike.** At a glance you see
    how non-linear the book is and whether the jumps land where you intended.
  - **Flashback markers** — scenes whose `when` is earlier than their neighbours'
    get a subtle badge in the tree / timeline.
- **Open:** the `when` type (number vs date vs label — probably support more than
  one, resolved to a sort key); how partial/unknown times sort; whether parallel
  timelines (two "presents") need a track/lane concept of their own.

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
when: 12 # NEW: story-time sort key (flashback if < neighbours)
threads: # today: [the-case, the-disguise]
  - thread: the-case # NEW richer form (must degrade to the bare id)
    beat: 'Holmes is hired' # #1
    intensity: setup # #5
  - thread: the-disguise
    beat: 'the groom disguise is chosen'
```

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
