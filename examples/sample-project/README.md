# Sample Project (fixture)

A small, self-contained writer-gui **Project** used for development and manual
testing. Open this folder (`examples/sample-project`) in the app.

It deliberately exercises the core features:

- **`project.json`** marks the folder as a Project (with a `threads` registry).
- **Manuscript order** — `manuscript/*.md` use sparse frontmatter `order`
  (10, 20, 30).
- **Threads** — files are tagged into `main`, `rebellion`, `romance`; some
  belong to multiple (intersections) for the braid visualiser.
- **Characters** — `characters/*.md` are entity profiles (with `aliases`);
  the manuscript mentions **Mara** and **Corvin** by name for character
  linking / find-references.

Keep it small and stable so tests can assert against it.
