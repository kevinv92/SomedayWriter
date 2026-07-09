# AI features (deferred)

_Part of the [SomedayWriter spec](./README.md)._

## AI features (split out — deferred)

AI is deliberately **separated from the deterministic core** and deferred to
post-v1. It rides the _same_ provider/facade pipe, so nothing about the editor or
`AnalysisService` changes when it lands — an AI feature is just another provider
whose brain happens to be an LLM.

- **`ContinuityProvider`** — surfaces **conflicting behavior / continuity errors**
  ("blue eyes in ch1, brown in ch9") as `diagnostics`. This genuinely needs
  semantic understanding of prose → an LLM.
- **Thread inference** — _suggesting_ threads/links the writer hasn't tagged
  (deterministic threads stay in the core; inference is AI).
- **AI writing assistant (chat panel)** — a conversational **side pane** (like an
  IDE chat), another pane in the multi-pane shell. Its differentiator: it's
  **grounded in the deterministic model** — it pulls context from `StoryIndex`
  (the current scene, the selection, relevant character profiles, a thread's
  beats) and can call the prose "language server" as **tools** (find-references,
  a character's mentions, manuscript order), so answers are anchored in the real
  project rather than guessed. Streams responses; can propose edits the writer
  applies. Unlike the other two, it's a **separate surface**, not an
  `AnalysisProvider` (chat, not diagnostics) — but it shares the same AI rules
  below. Claude is the natural default model; provider-flexible.

Constraints when it lands:

- Runs in the **main process** (holds the API key; renderer never sees secrets).
- Opt-in and clearly labeled; deterministic features never depend on it.
- Diagnostics/inference use the same `AnalysisProvider` interface; the chat
  assistant is a separate pane but obeys the same key/opt-in/independence rules.
- Post-v1, its own later **AI phase** — after the deterministic phases (5–9).

### Model access & billing

The **primary AI-integration strategy is the MCP server** (below); the in-app
chat panel is a secondary, optional convenience.

- **writer-gui as an MCP server — the committed path.** See _MCP server_. The AI
  lives in the user's client; writer-gui exposes tools. **No API key, no metered
  charges** (runs on the user's existing subscription), and it's **not AI code in
  the app** — just deterministic tool exposure.
- **In-app chat panel (optional, deferred).** If someone wants AI _inside_
  writer-gui, it embeds a client needing the **Anthropic API (metered)** or
  **bring-your-own-key**. A Claude **Pro/Max subscription cannot be used here** —
  subscription OAuth is for Anthropic **first-party** clients (Claude Code /
  Desktop / official extension), not third-party apps. writer-gui **never ships
  its own key.**
