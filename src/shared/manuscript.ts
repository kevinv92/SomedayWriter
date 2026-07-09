/**
 * Manuscript compile/export — pure text transforms shared by main (the export
 * IPC) and, potentially, the MCP server. No fs, no Electron: give it scene text,
 * get clean prose back.
 *
 * It applies the "stripped on export" contract (SPEC → Editorial marks &
 * Mentions): the reader should see finished prose, never the writer's scaffolding.
 *   - YAML frontmatter               → removed
 *   - `%% unanchored note %%`        → removed (single- or multi-line)
 *   - `{>> anchored comment <<}`     → removed
 *   - `{== highlighted span ==}`     → unwrapped to its text
 *   - `<!-- thread:x -->` markers    → removed
 *   - `@{mention}`                   → unwrapped to the surface text
 *   - CriticMarkup tracked changes   → resolved (see `changes`)
 */

export type ChangeResolution = 'accept' | 'reject'

export interface CompileOptions {
  /** How to resolve CriticMarkup suggested edits. Default `'accept'` — the
   *  exported draft reads as if every tracked change were accepted. */
  changes?: ChangeResolution
  /** Text inserted between scenes. Default one blank line (`'\n\n'`). */
  separator?: string
  /** Prefix each scene with its title as an H1. Default `false` — most drafts
   *  want continuous prose, not a heading per scene. */
  sceneTitles?: boolean
}

export interface CompileScene {
  /** Full file text, frontmatter included (stripped here). */
  text: string
  /** Human title (from `title:` frontmatter or the first heading / filename). */
  title: string
}

/** Drop a leading YAML frontmatter block (`---\n … \n---`). Tolerates a BOM. */
export function stripFrontmatter(text: string): string {
  return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*\r?\n?/, '')
}

/**
 * Apply the strip-on-export contract to a scene BODY (frontmatter already gone).
 * Order matters: resolve tracked changes first, then remove comments before
 * unwrapping the highlight they were anchored to (`{==span==}{>> note <<}`).
 */
export function stripEditorial(
  body: string,
  changes: ChangeResolution = 'accept'
): string {
  const accept = changes === 'accept'
  let s = body
    // CriticMarkup substitution {~~ old ~> new ~~}
    .replace(/\{~~([\s\S]*?)~>([\s\S]*?)~~\}/g, (_m, oldT, newT) =>
      accept ? newT : oldT
    )
    // CriticMarkup insertion {++ … ++}
    .replace(/\{\+\+([\s\S]*?)\+\+\}/g, (_m, t) => (accept ? t : ''))
    // CriticMarkup deletion {-- … --}
    .replace(/\{--([\s\S]*?)--\}/g, (_m, t) => (accept ? '' : t))
    // Anchored comments {>> … <<} — gone entirely
    .replace(/\{>>[\s\S]*?<<\}/g, '')
    // Highlighted spans {== … ==} — unwrap to the text
    .replace(/\{==([\s\S]*?)==\}/g, '$1')
    // Unanchored notes %% … %% (single- or multi-line)
    .replace(/%%[\s\S]*?%%/g, '')
    // Inline thread markers <!-- thread:x -->
    .replace(/<!--\s*thread:[\s\S]*?-->/g, '')
    // Mentions @{surface} — unwrap to the surface text
    .replace(/@\{([^}]+)\}/g, '$1')

  // Tidy the holes the removals leave: collapse runs of blank lines, and trim
  // trailing spaces a mid-line removal may have stranded.
  s = s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n')
  return s
}

/** Compile ordered scenes into one manuscript string. */
export function compileManuscript(
  scenes: CompileScene[],
  opts: CompileOptions = {}
): string {
  const changes = opts.changes ?? 'accept'
  const separator = opts.separator ?? '\n\n'
  const parts = scenes
    .map((scene) => {
      let body = stripEditorial(stripFrontmatter(scene.text), changes).trim()
      if (opts.sceneTitles && scene.title) body = `# ${scene.title}\n\n${body}`
      return body
    })
    .filter((body) => body.length > 0)
  return parts.length ? parts.join(separator) + '\n' : ''
}

/** Word count for a compiled manuscript (already stripped — just count tokens). */
export function countManuscriptWords(compiled: string): number {
  return compiled.trim().match(/\S+/g)?.length ?? 0
}
