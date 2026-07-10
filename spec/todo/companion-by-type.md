# A type-aware Companion pane

_Part of the [SomedayWriter spec](../README.md) · design backlog
([todo](./README.md))._

**Status:** _needs design_ (drafting the shape; nothing committed).

**Intent.** The **Companion pane** should show a view **tailored to the active
file's entity `type`** — not one fixed behavior. Open a character and it shows that
character's footprint; open a thread and it shows the arc; open a scene and it does
what it does today. The [thread detail](./improve-threads.md) (#7) is the first
concrete case; this doc is the general pattern behind it.

## Today

The Companion (Phase 5, M8d — `CompanionPanel`) is already the app's **per-file,
context-following** pane: for a scene it auto-follows the entities in view, with
pin-to-freeze. But it has **one** mode — it always shows "entities in this scene."
Every other kind of file gets that same (often empty) view.

## Proposal — pick the Companion view by the active file's `type`

The pane reads the active file's `type` (from the **entity-type registry** — the
same source that drives badges, templates, and intellisense) and renders a view
for it, falling back to a generic default for any type without a bespoke one:

| Active file `type` | Companion shows                                                                                            |
| ------------------ | ---------------------------------------------------------------------------------------------------------- |
| scene / untyped    | entities appearing in this scene (**today's behavior**)                                                    |
| `thread`           | the thread's beats in order + arc stats ([improve-threads.md](./improve-threads.md) #7)                    |
| `character`        | their **footprint** — scenes/beats they appear in, aliases, threads they're on, who they share scenes with |
| `location`         | scenes set here; who appears here                                                                          |
| `item`             | scenes it appears in; who holds/uses it                                                                    |
| `faction`          | members + references                                                                                       |
| _any other type_   | **default:** references to this entity + its frontmatter fields (a curated find-references)                |

The default matters: a project's **custom** types get something useful for free;
a bespoke view is opt-in, added only where it earns its keep.

## Architecture

- A small **registry: `type` → CompanionView renderer**, with a default renderer.
  Mirrors how the entity-type registry already fans out — add a type, it gets the
  default automatically.
- Views are **composition over existing queries** — `referencesTo`, `sceneEntities`,
  `buildThreads` already produce the data; each view just arranges it. Little new
  main-process work.
- **Pin-to-freeze** still applies — freeze the current Companion regardless of what
  you navigate to next.

## Relationship to the Inspector

They're complementary, not duplicates:

- **Inspector** = the _raw parse_ of the active file (what the app read: frontmatter
  fields, warnings). File-local, literal.
- **Companion** = _curated cross-file context_ (where this entity lives in the
  story). Derived, relational.

## Use cases

- Open a **character** → every scene they're in and who they share scenes with,
  without running find-references by hand.
- Open a **location** → every scene set there, at a glance.
- Open a **thread** → the arc (the #7 case).

## Open questions

- Which bespoke views ship first vs. lean on the default? (Likely: default +
  scene + thread first; character/location next.)
- **Automatic by type**, or a small view-switcher in the pane header for entities
  that could sensibly show more than one thing?
- Do **project-defined custom types** ever get a bespoke view, or always the
  default (bespoke = built-in types only, unless a config hook lands later)?
- Pin-to-freeze semantics across a type switch.
- Is "Companion" still the right label once it's type-aware? (Probably — it's still
  the context companion to whatever you're viewing.)

## Tasks (when this ships)

- [ ] Companion **view registry** (`type` → renderer) + a default (references +
      fields) renderer.
- [ ] Scene view = today's behavior, moved behind the registry.
- [ ] Thread view (= [improve-threads.md](./improve-threads.md) #7).
- [ ] Character / location / item views (footprint queries over the story index).
- [ ] **Docs & help:** README bullet ("the Companion adapts to what you're
      viewing"), the in-app Help guide, and the syntax/entity reference.
- [ ] Tests for the per-type data queries.

## Related

- [improve-threads.md](./improve-threads.md) — #7, the thread-detail instance.
- [story-model.md](../story-model.md) — entities, the type registry, the Companion.
- [frontmatter-help.md](./frontmatter-help.md) — also registry-driven; keep them
  sharing one source of truth for what each type is.
