# Story-time timeline — chronology & flashbacks

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _needs design_ (drafting the shape; nothing committed).

**Intent.** Model the **two timelines** every non-linear story has — the order
events are _told_ (narrative order) and the order they _happen_ (story-time) — so
a writer mixing flashbacks, flash-forwards, or parallel timelines can actually see
and trust the chronology instead of holding it in their head.

Came out of the threads/timeline design ([improve-threads.md](./improve-threads.md)),
but it's a **separate feature**: it's about _all_ scenes, threaded or not, so the
threads doc explicitly scopes it out and points here. The two share the timeline
_surface_ — design them together — but neither owns the other.

---

## The problem

The app today knows only **narrative order** (frontmatter `order` — the sequence
the reader meets scenes). That's the right default, but it's half the picture:

- A **flashback** is a scene whose story-time is _earlier_ than the scenes around
  it. A **flash-forward** is _later_.
- With even a few of these, "when did this actually happen?" and "have I kept the
  causal chain straight?" become guesswork. There's nothing in the tool to check
  against — the second timeline is invisible.

(The classic story/plot, _fabula_/_syuzhet_ distinction. We already nail narrative
order; this is the missing companion.)

## Data model (sketch — not committed)

A single optional, **sparse** scene-frontmatter field:

```yaml
order: 30 # narrative order — the order it's TOLD (exists today)
when: 12 # NEW — story-time: the order it HAPPENS
```

`when` needs to resolve to a **sort key**; support more than one authoring style
and normalise:

- **Chrono index** — a bare number, like `order` but for story-time (simplest;
  fractional so inserts are cheap).
- **Date / datetime** — `when: 1888-03-20` for stories that are calendar-real.
- **Named era + offset** — `when: "Before the war"` (+ optional order within the
  era) for stories with fuzzy time.

Scenes without `when` **fall back to narrative order**, so existing flat projects
render unchanged. Nothing here is required.

## Views it unlocks

### 1. Chronology ordering (an axis mode)

A third ordering next to _manuscript_ and _follow-thread_ on the existing
timeline: lay scenes out by `when`, so the true sequence of events reads
independent of how it's told. Reuses the braid's axis machinery
([improve-threads.md](./improve-threads.md)); the lanes/threads still work.

### 2. Told-vs-happened plot (the one to build first)

A small 2-D chart: **x = narrative order, y = story-time**, one dot per scene.

- A perfectly linear book is a clean **diagonal**.
- Every **flashback dips below** the diagonal; every **flash-forward spikes
  above** it.
- At a glance: how non-linear the book is, whether jumps cluster where you
  intended (e.g. a flashback-heavy act 2), and whether any leap is so large it'll
  disorient a reader. Click a dot → open the scene.

This is the highest-value piece — it turns an invisible mental model into a shape
you can read in one second.

### 3. Flashback / flash-forward markers

Cheap, always-on affordance: a scene whose `when` is out of step with its
narrative neighbours gets a subtle badge (↩ back / ↪ forward) in the file tree and
on the timeline. No dedicated view needed.

### 4. Parallel timelines (later)

Stories with two concurrent "presents" (A-plot now / B-plot elsewhere-now) may
need story-time split into **named tracks** so each advances on its own axis.
Design this only if the single-axis model proves too flat — flag it, don't build
it up front.

## Relationship to neighbours

- **Threads braid** ([improve-threads.md](./improve-threads.md)) — shares the
  timeline surface and axis-ordering concept; chronology is another axis mode
  there. Design the two together so they don't reinvent axis logic.
- **Manuscript order** ([manuscript.md](../manuscript.md)) — `order` stays the
  canonical _told_ sequence and the export spine; `when` is purely additive.
- **Story model** ([story-model.md](../story-model.md)) — scenes are already
  indexed; this adds one derived field to the index.

## Open questions

- **`when` type** — pick one canonical internal sort key; how do mixed authoring
  styles (number vs date vs label) coexist and compare? How do unknown/partial
  times sort (end? nearest neighbour?)?
- **Is a flashback a scene or a span?** A scene that's _mostly present with a
  paragraph of memory_ isn't fully a flashback — does story-time ever need to
  attach to an inline range (like `<!-- thread:x -->` markers do) rather than the
  whole scene?
- **Ambiguity** — many stories are deliberately vague about time. The UI must make
  `when` optional and never nag; unmarked scenes just sit on the narrative
  diagonal.
- **Parallel tracks** — needed for v1, or a later addition?
- Where the told-vs-happened plot lives — its own panel, or a mode of the
  Threads · Timeline pane?

## Related

- [improve-threads.md](./improve-threads.md) — Threads v2 (shares the timeline).
- [manuscript.md](../manuscript.md) — narrative `order`, inline markers.
- [roadmap.md](../roadmap.md) — where a committed timeline would slot in.
