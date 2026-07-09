# Project model & settings

_Part of the [SomedayWriter spec](./README.md)._

## What defines a "Project"

A directory is a Project if it contains a `project.json` at its root. Opening a
folder without one offers to create it (initialize a new project).

### `project.json`

```json
{
  "project": {
    "name": "My Novel",
    "version": "1"
  },
  "editor": {
    "defaultExtension": "md",
    "wordWrap": true,
    "diagnostics": false,
    "measure": 46,
    "font": "serif",
    "fontSize": 16,
    "lineHeight": 1.7,
    "autosave": false
  },
  "explorer": {
    "ignore": [".git", "node_modules", "*.tmp"]
  }
}
```

- `project.name` is required; everything else has defaults.
- Unknown keys are preserved on save (don't clobber fields the app doesn't know).
- `editor.measure` — the editor text-column width ("measure") in **rem**
  (default `46`), or `"full"` to fill the pane. Deliberately fixed and centered
  for prose readability; widening the window doesn't stretch the text.
- **Editor typography** — `editor.font` (a preset `serif` | `sans` | `mono`, **or
  any CSS font-family string** naming a font installed on the system, e.g.
  `"GT Sectra, Georgia, serif"`), `editor.fontSize` (px, default 16), and
  `editor.lineHeight` (unitless, default 1.7). Applied via CSS variables on the
  editor pane — no editor rebuild.
- **Custom / paid fonts.** An **installed** font works today (just name it in
  `editor.font`). Loading a font **file** that isn't installed — or one that
  should travel with the project — needs an `@font-face` served through the
  guarded `writer-file://` protocol (the same one proposed for images); a future
  `editor.fontFile` setting. The app **never bundles or ships fonts** — it only
  points at fonts the user already has; committing a paid font file into a shared
  project is the user's licensing call.
- The above are wired now but require hand-editing `project.json`; a **settings
  UI** and a **global default with per-project override** land in Phase 6
  (decision #28).

## App settings (global) vs project config

Two tiers of configuration, stored **separately**:

- **Project config — `project.json`** (per project, in the folder). Describes the
  _project_ as **tool/editor configuration**: name, `explorer.ignore`, and
  per-project editor defaults (`wordWrap`, `diagnostics`, `defaultExtension`).
  **Story content — threads, entities — lives in files, not here** (decision #45).
  Travels with the folder; lives in the writer's repo.
- **App settings — `settings.json`** in the OS user-data dir
  (`app.getPath('userData')`, e.g. `~/Library/Application Support/writer-gui/`).
  Describes the _app / user_, independent of any project: **recent projects**
  (paths + last-opened), the project to reopen on launch, window bounds, and
  global editor preferences (e.g. Vim default, theme). **Never** inside a project
  folder.

Rules:

- **Main owns both**; the renderer reaches them only through typed `window.api`
  (`getSettings()` / `updateSettings(patch)`), never touching `fs` — same stance
  as the project methods.
- **Precedence** — where a setting exists in both tiers, the **project value wins**
  for that project (e.g. a project can force `diagnostics` on); app settings are
  the default when the project doesn't specify.
- **Plain JSON, zero-dep** (decision #3) — no `electron-store`; `settings.json` is
  read/written with native `JSON`, unknown keys preserved.
- **Introduced in Phase 6** with recent projects (M12); nothing before then needs
  global storage.

## File titles (derived, not duplicated)

A scene/chapter's display **title** — shown in the binder/tree, the thread
visualiser's nodes, the inspector, and export — is **derived**, not required in
frontmatter. Otherwise the same name is declared three times (filename +
frontmatter `title` + `#` heading) and the copies drift apart.

Resolution order (first hit wins):

1. **`frontmatter.title`** — an explicit override, for when the display title
   must differ from the heading, or the file has no `#` heading.
2. **The first `#` (H1) heading** in the body — the natural source; it's already
   visible in the prose.
3. **The filename** — prettified (strip the `NN-` order prefix and `.md`,
   title-case) as a last resort.

So a normal file declares **no** `title`; it just has `# Arrival`. Frontmatter
`title` stays available for the override case. `StoryIndex` computes the title
(Phase 5) so every consumer agrees on one value.
