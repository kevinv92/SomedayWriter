# Threads v2 — from membership to movement · _shipped & graduated_

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

> **Status: GRADUATED (2026-07-10).** All eight improvements shipped. The design
> now lives in the permanent spec — **[story-model.md](../story-model.md) →
> _Beat fields_ and _Thread views_** — with the model decisions recorded in
> [DECISIONS.md](../../DECISIONS.md) (#47 `summary`-not-`beat`, #48 `state`-based
> branch/merge, #49 `order`→`pos`). This file is kept as a short record; the full
> design history (use cases, sketches, slice plan) is in git before this commit.

## What shipped

The braid went from a _table of contents_ (a dot says "thread X is in scene Y")
to a **storytelling instrument** that shows how each thread **moves**. Beats gained
three optional, sparse frontmatter fields — `summary`, `intensity`, `state` — and
the views grew to read them.

| #   | Improvement                      | Where it lives now                                       |
| --- | -------------------------------- | -------------------------------------------------------- |
| 1   | Per-beat `summary`               | braid tooltip + follow-a-thread outline                  |
| 2   | Pacing / gap lint                | Project Health "Neglected threads" (`threads.gapScenes`) |
| 5   | `state` lifecycle + branch/merge | braid open/close caps + inferred connectors              |
| 7   | Companion thread-mode            | Companion arc view when a `type: thread` file is open    |
| 6   | Threads Dashboard                | main-pane view, `Timeline \| List` modes                 |
| 4   | Intensity → lane shape           | braid lane as a tension curve                            |
| 3   | Word-weighted axis               | braid `Width: Even \| By length` toggle                  |
| 8   | Minimap / scrubber               | strip under the braid, draggable viewport rect           |

Plus the authoring loop: **`threads:` object intellisense** (inner keys +
`intensity`/`state` enums + `name:` thread surfaces) and a beat scaffold.

## Remaining follow-ups (not Threads v2 core)

- **Drag-to-edit the braid (M11)** — rearrange structure from the board, writing
  membership + `pos` back to files. Deferred; tree-drag + frontmatter editing
  cover rearrangement today. See [story-model.md](../story-model.md) → Thread views.
- **Full companion-by-type registry** — Slice D was the first case; the general
  `type → view` refactor is its own doc, [companion-by-type.md](./companion-by-type.md).
- **In-editor frontmatter help button** — [frontmatter-help.md](./frontmatter-help.md).
- **Story-time / chronology** (`when:`) — a separate feature,
  [story-timeline.md](./story-timeline.md), not scoped into Threads v2.
