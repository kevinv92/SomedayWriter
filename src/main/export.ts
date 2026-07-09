import { promises as fs } from 'node:fs'
import { listMarkdownFiles } from './fs-project'
import { deriveTitle, parseFrontmatter, readOrder } from './frontmatter'
import type { CompileScene } from '../shared/manuscript'

/** A manuscript scene: an `.md` file with an `order`, that isn't an entity
 *  profile (a `type:` file is a character/location/thread page, not prose). */
export interface GatheredScene extends CompileScene {
  order: number
  path: string
}

/**
 * Collect the manuscript scenes under `root`, in reading order. Same selection
 * rule as the MCP `reading_order` tool: a scene is a Markdown file with numeric
 * `order` frontmatter and no `type:` (entity profiles are excluded).
 */
export async function gatherManuscript(
  root: string,
  ignore: string[]
): Promise<GatheredScene[]> {
  const files = await listMarkdownFiles(root, ignore)
  const scenes: GatheredScene[] = []
  for (const path of files) {
    let text: string
    try {
      text = await fs.readFile(path, 'utf8')
    } catch {
      continue
    }
    const order = readOrder(text)
    if (order == null) continue
    if (typeof parseFrontmatter(text).data.type === 'string') continue
    scenes.push({ text, title: deriveTitle(text, path), order, path })
  }
  scenes.sort((a, b) => a.order - b.order)
  return scenes
}
