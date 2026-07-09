# SomedayWriter — Spec

A calm, local-first desktop app for writing long-form prose (novels, scripts,
docs). Built on Electron. A **Project** is a folder on disk that contains a
`project.json`; the app opens that folder, shows its files in a tree on the left,
and edits the selected file on the right. Everything stays as ordinary `.md`
files — no proprietary format, no lock-in.

> **Status (early preview, v0.1).** Phases 0–11 are built and merged — the editor
> and file model, the story index (entities / mentions / threads), editorial
> marks, the visual design system, external grammar/LSP analysis, the MCP server,
> **and manuscript export (Markdown + EPUB)**. A **Vitest** suite covers the key
> pure logic, and CI (lint · typecheck · test · build) runs on every push, with a
> tagged-release workflow that ships a macOS DMG. Remaining: the unified
> command/keybinding system (Phase 12) and the deferred lane (AI continuity, more
> export targets). See [roadmap.md](./roadmap.md).

This spec is sliced into focused files; each is linked below and cross-links back
here. Historical decisions live in [../DECISIONS.md](../DECISIONS.md); working
standards in [../AGENTS.md](../AGENTS.md).

## Goals

- Open a folder as a **Project** and browse its files.
- Edit **Markdown (`.md`) files only** with a clean, distraction-light editor.
- Keep everything as ordinary files on disk — no proprietary database, no lock-in.

## Non-goals (for now)

- **Non-Markdown files.** v1 edits `.md` only. Other files may appear in the tree
  (greyed / read-only or ignored), but the editor, analysis, and story features
  target Markdown.
- Real-time collaboration / cloud sync.
- Rich WYSIWYG formatting beyond Markdown.
- Version control UI (the folder can be a git repo, but the app doesn't manage it).

## The spec, sliced

| File                                   | Covers                                                                      |
| -------------------------------------- | --------------------------------------------------------------------------- |
| [architecture.md](./architecture.md)   | Tech stack, source layout, the `EditorAdapter` seam, process/IPC design     |
| [project-model.md](./project-model.md) | What defines a Project, app-settings vs project config, derived file titles |
| [manuscript.md](./manuscript.md)       | Manuscript order, the scene→chapter→act hierarchy, comments & CriticMarkup  |
| [story-model.md](./story-model.md)     | Entities, mentions, references, threads, the Inspector & Companion panes    |
| [analysis.md](./analysis.md)           | The pluggable language-intelligence facade (spell / grammar / LSP)          |
| [navigation.md](./navigation.md)       | Search, Quick Open, command palette, keyboard navigation & focus            |
| [mcp.md](./mcp.md)                     | The MCP server that exposes the project to Claude                           |
| [ai.md](./ai.md)                       | Deferred AI features (continuity, thread inference)                         |
| [roadmap.md](./roadmap.md)             | Core-feature list, phases, and the deferred backlog                         |
| [terminology.md](./terminology.md)     | Glossary                                                                    |
