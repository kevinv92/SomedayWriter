# A Scandal in Bohemia (example project)

A richer writer-gui **Project** built from Sir Arthur Conan Doyle's public-domain
Sherlock Holmes story _"A Scandal in Bohemia"_ (1891), translated into the app's
format. Open this folder (`examples/scandal-in-bohemia`) in the app.

It is meant to show the features off with real prose, not lorem ipsum:

- **`project.json`** marks the folder as a Project. It ships two custom themes
  (`Gaslight`, `Foolscap`) and an `entityTypes` override adding a
  `first-appearance` field to locations.
- **Manuscript order** — the seven `manuscript/*.md` scenes carry sparse `order`
  frontmatter (10, 20, … 70) so they read in narrative sequence.
- **Threads** — every scene is tagged into one or more storylines
  (`the-case`, `holmes-and-watson`, `the-woman`) for the braid visualiser. Some
  scenes sit on two threads at once (intersections).
- **Entities** — profiles across `characters/`, `locations/`, `items/`,
  `factions/`, and `threads/`, each with `aliases` and type-specific fields
  (`owner`, `leader`, `region`, thread `color`/`description`).
- **Explicit mentions** — the prose wraps every entity reference in braces, e.g.
  `@{Holmes}`, where the text inside matches an entity `name` or alias exactly, so
  find-references and the inspector light up. There are no dead references.
- **Author notes** — `%% ... %%` private notes are sprinkled through the scenes.
- **Editorial comments** — a couple of `{==highlighted==}{>>comment<<}` spans
  mark passages for revision.

## What's inside

| Kind       | Files                                                                                      |
| ---------- | ------------------------------------------------------------------------------------------ |
| Characters | Sherlock Holmes, John Watson, Irene Adler, Wilhelm von Ormstein (the King), Godfrey Norton |
| Locations  | Baker Street, Briony Lodge, Church of St. Monica, The Temple                               |
| Items      | The Photograph, The Smoke Rocket, The Emerald Ring                                         |
| Factions   | House of Ormstein                                                                          |
| Threads    | The Case, Holmes and Watson, The Woman                                                     |
| Scenes     | 01 The Woman → 07 The Empty Nest                                                           |

The text is public domain. Prose has been faithfully excerpted and lightly
abridged to fit seven scenes.
