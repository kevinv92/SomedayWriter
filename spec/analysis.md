# Analysis — pluggable language intelligence

_Part of the [SomedayWriter spec](./README.md)._

## Analysis — pluggable language intelligence

Active feedback (errors/squiggles + intellisense) follows the LSP model, but the
editor never talks to a concrete engine. It talks to one stable facade; the
intelligence behind it is **pluggable**. v1 ships lightweight in-app providers;
a full external LSP client can be dropped in later as just another provider,
with no editor changes.

### Layers

```
CodeMirror 6                AnalysisService              Providers (pluggable)
 (lint + autocomplete) ──►  (facade / registry)  ──►  ┌───────────────────────┐
        ▲                         │                   │ SpellProvider         │
        │  diagnostics (push)     │  fan-out /         │ StyleProvider         │
        └── completions (pull) ◄──┘  aggregate         │ RefProvider (@links)  │
                                                       │ LspProvider (later)   │
                                                       └───────────────────────┘
```

- **Editor** only knows the CM6 `linter()` and `CompletionSource` hooks. It
  renders whatever diagnostics/completions the facade emits.

**Diagnostics are off by default.** Squiggles in the middle of prose fight
drafting, so the whole diagnostics channel (spelling, style, and later
continuity) is **opt-in**:

- Controlled by `editor.diagnostics` in `project.json` (default `false`) and a
  quick toggle in the UI (status bar / View menu). Off = the facade suppresses
  all diagnostics; providers may still run for completions/references.
- Completions and references (the `@`/character features) are **not** affected —
  those are pull-based and only appear when asked, so they stay on.
- Later this can be per-severity or per-provider (e.g. allow a hard broken-link
  error while muting style hints), but v1 is a single global on/off, defaulting
  off.
- **`AnalysisService`** is the single facade: it holds a registry of providers,
  forwards document changes to all of them, aggregates their diagnostics, and
  merges completion results. Debounce, cancellation, and stale-result dropping
  live here — once, not per provider.
- **Providers** are the plugins. Each implements the same interface and declares
  which capabilities it offers. They can run in-renderer, in a Web Worker, or
  proxy to an external process — the facade doesn't care.

### Provider interface

```ts
interface AnalysisProvider {
  id: string
  capabilities: Array<'diagnostics' | 'completion' | 'hover'>

  // Document lifecycle (mirrors LSP didOpen/didChange/didClose)
  didOpen?(doc: Doc): void
  didChange?(doc: Doc, changes: TextChange[]): void
  didClose?(uri: string): void

  // Push: provider emits diagnostics whenever it has new results
  onDiagnostics?(cb: (uri: string, diags: Diagnostic[]) => void): void

  // Pull: editor asks for completions/hover at a position
  complete?(uri: string, pos: Position): Promise<Completion[]>
  hover?(uri: string, pos: Position): Promise<Hover | null>

  dispose?(): void
}
```

The `Doc`, `TextChange`, `Diagnostic`, `Position`, `Completion` shapes are
deliberately LSP-compatible so an `LspProvider` is a thin translation layer, not
a new model.

### Pluggability rules

- Providers register with the facade at startup (and could later come from
  project config or an extension folder).
- Adding/removing a provider **must not** touch editor or facade code.
- The facade merges results: diagnostics are the union (tagged by `provider.id`
  for filtering); completions are concatenated and de-duplicated.
- A slow or crashing provider is isolated — the facade times it out and drops its
  results rather than blocking the keystroke.

### Provider implementation language

Everything we build is **TypeScript**, running in the renderer, a Web Worker, or
the main process depending on what the provider needs (`fs`, secrets, heavy CPU).
The only non-TS case is a future external LSP server, which can be any language —
we'd only write the TS `LspProvider` adapter, not the server.

### Path to full LSP — ✅ built (Phase 10)

1. **v1** — in-app providers only (spell/style/refs).
2. **Done** — external grammar/style now rides the facade two ways, both behind a
   `settings.json` `grammar` block (off by default; network + API key live in the
   main process and are stripped before reaching the UI):
   - **`languagetool-provider`** POSTs to a **LanguageTool** `/v2/check` HTTP API
     (self-hostable, so prose can stay on-device); `src/main/grammar.ts` maps
     `matches[]` → the shared `GrammarMatch`.
   - **`lsp-provider`** speaks to a **real language server** (e.g. `ltex-ls`) over
     JSON-RPC/stdio (`src/main/lsp.ts` — Content-Length framing, initialize/
     didOpen/didChange, a main-side text mirror to convert LSP positions), pushing
     `publishDiagnostics` to the renderer over an `lsp:diagnostics` channel.
   - Main routes to **one** engine (LSP supersedes HTTP when configured) so there
     are never double squiggles. The editor and facade were unchanged — exactly
     the seam this section promised.
