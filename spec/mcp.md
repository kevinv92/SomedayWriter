# MCP server

_Part of the [SomedayWriter spec](./README.md)._

## MCP server (writer-gui as tools) — committed

writer-gui exposes the open project as an **MCP server** so any MCP client
(Claude Code, Claude Desktop, the Claude VS Code extension) can reason over the
manuscript. **This is the committed AI-integration surface** — chosen because it
sidesteps API billing (the client carries the user's subscription), keeps AI code
out of writer-gui, and makes the deterministic prose "language server" reusable by
any client.

- **What it exposes** — **resources**: project files (read) + `project.json`;
  **tools** built on `StoryIndex`: `findReferences(entity)`, `definitionOf(entity)`,
  `mentionsIn(file)`, `threadBeats(thread)`, manuscript `order`, and
  project-wide search. So a prompt like _"is Mara's arc consistent?"_ is answered
  against the real index, not guessed.
- **The MCP server is deterministic, not AI** — no LLM, no key. It's the same
  `StoryIndex` the in-app providers use, projected over the Model Context
  Protocol. So it's a **committed** feature, not part of the deferred-AI lane.
- **Depends on `StoryIndex`** (Phase 5) for the valuable tools; file
  read/search resources could be exposed earlier. Runs in the main process.
- Writes (if any tool edits files) go through the **same guarded path** as the
  renderer — an MCP client can't reach outside the open project.
