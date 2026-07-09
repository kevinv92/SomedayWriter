# Changelog

All notable changes to writer-gui are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0, minor versions may include breaking changes as the format settles.

## [Unreleased]

### Added

- `AGENTS.md` scaffolded into new projects — a templated brief so any agent CLI
  (Claude Code, Codex, Cursor, …) pointed at the folder understands the project's
  story conventions (frontmatter entities, threads, `@{}` mentions).
- App version shown in the Help panel (marked `preview`).
- **External-edit conflict guard** — saving a file that changed on disk since it
  was opened now prompts (Overwrite / Reload / Cancel) instead of silently
  overwriting the external change. Makes it safe to run an agent CLI over the
  same project folder.
- **Reload from disk** is now a dedicated toolbar button and also re-reads open,
  unsaved-edit-free tabs so external changes become visible immediately.

### Changed

- Renamed the app to **SomedayWriter**.

## [0.1.0] — Unreleased

First tagged build. Everything below shipped during the pre-1.0 build-out.

### Added

- Markdown editor (CodeMirror 6) with a warm-paper design system, light/dark
  themes, accent colors, focus mode, and configurable fonts.
- Project model — a folder becomes a project via `project.json`; a controlled
  settings form edits it (no raw JSON).
- Story intelligence — frontmatter entities (`type:`), `@{}` mentions with
  go-to-definition and find-references, aliases, threads, and a timeline.
- Panels — Companion, Inspector, References, Threads, Timeline, Comments, and
  Project Health (flags mentions that no longer resolve).
- Editorial marks — highlights, comments, and tracked changes (CriticMarkup),
  with accept/reject at the cursor.
- Navigation — Quick Open (⌘P), Command Palette (⌘⇧P), back/forward history,
  draggable tabs, and image show/insert with an inline viewer.
- External analysis (Phase 10) — optional LanguageTool (HTTP) and LSP grammar
  providers behind one facade; the API key stays in the main process.
- MCP server (Phase 11) — a standalone stdio server exposing the manuscript as
  resources plus tools (`find_references`, `thread_beats`, root-guarded
  `write_file`, …) so Claude can read and reason over the project.
- In-app Help documenting every feature and how to connect Claude.

[Unreleased]: https://github.com/
[0.1.0]: https://github.com/
