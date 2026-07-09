import { promises as fs } from 'fs'
import { join } from 'path'

/**
 * The `AGENTS.md` scaffolded into new projects. `AGENTS.md` is the cross-tool
 * convention (Claude Code, Codex, Cursor, …) for briefing an agent CLI on a
 * repository — so it's LLM-agnostic on purpose. Here it teaches any agent
 * writer-gui's story conventions (frontmatter entities, threads, `@{}`
 * mentions) so it understands the manuscript instead of reverse-engineering
 * it. Plain Markdown — no AI code, no dependency, no network.
 */

export const AGENTS_FILE = 'AGENTS.md'

/** The templated brief written into `<name>/AGENTS.md`. */
export function defaultAgentsDoc(name: string): string {
  return `# ${name}

This is a **SomedayWriter** project — a prose manuscript kept as plain Markdown
files on disk. There's no build step and no database: the folder *is* the
project. Everything below is a convention the app understands; honour it and
your edits will show up correctly in the editor.

## Layout

- \`project.json\` — project config (title, editor defaults, ignored paths,
  custom entity types). Don't edit it unless asked.
- \`*.md\` — the writing. Two kinds:
  - **Scenes** — the manuscript itself (chapters, scenes, sections).
  - **Entities** — a file describing a character, location, item, etc. An
    entity is any \`.md\` file whose frontmatter has a \`type:\`.
- Subfolders group things however the author likes (e.g. \`manuscript/\`,
  \`characters/\`, \`locations/\`). Folder names carry no special meaning.

## Frontmatter (the \`---\` block at the top of a file)

\`\`\`yaml
---
type: character          # marks this file as an entity (omit for plain scenes)
aliases: [Irene, the woman]   # other names that should resolve to this entity
threads: [the-case]      # storylines this scene belongs to (slugs)
order: 10                # this scene's position in the manuscript
---
\`\`\`

- \`type:\` — the entity kind. Valid values come from \`project.json\`
  (characters, locations, items, factions, threads, …).
- \`aliases:\` — alternate names a mention can match.
- \`threads:\` — storyline slugs; scenes sharing a slug form one thread.
- \`order:\` — manuscript sort key (ascending). Only scenes need it.

Keep frontmatter valid YAML. Preserve keys you don't understand.

## In-prose syntax

- \`@{Irene Adler}\` — a **mention**: a reference to an entity by its name or an
  alias. This is how the app links scenes to characters/places. When you rename
  an entity, update its \`@{…}\` mentions everywhere (or add the old name to that
  entity's \`aliases:\`) so nothing dangles.
- \`%% note %%\` — a private author note (not part of the prose).
- Editorial marks (CriticMarkup): \`{==highlight==}\`, \`{>>comment<<}\`,
  \`{++insert++}\`, \`{--delete--}\`, \`{~~old~>new~~}\`. Use these for suggestions
  rather than silently rewriting, when the author asked for feedback.

## Working here

- Write in the manuscript's established voice and tense — match the surrounding
  prose, don't impose a house style.
- Editing a scene? Leave its frontmatter (\`order\`, \`threads\`) intact.
- Adding a character/place? Create an entity file with a \`type:\`, then mention
  it with \`@{Name}\` where it appears.
- When in doubt about who/what a name refers to, grep for its entity file and
  its \`aliases:\` before assuming.
`
}

/** Write the templated `AGENTS.md` into a project root, but never overwrite an
 * existing one — the author may have written their own. Best-effort: a failure
 * here must not fail project creation. */
export async function writeDefaultAgentsDoc(root: string, name: string): Promise<void> {
  const path = join(root, AGENTS_FILE)
  try {
    // 'wx' fails if the file already exists, so we never clobber an author's doc.
    await fs.writeFile(path, defaultAgentsDoc(name), { encoding: 'utf8', flag: 'wx' })
  } catch {
    // Already present, or unwritable — leave it alone.
  }
}
