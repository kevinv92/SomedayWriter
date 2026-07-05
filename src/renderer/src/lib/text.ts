/**
 * Count words in Markdown prose, ignoring a leading YAML frontmatter block and
 * inline `%% note %%` comments (they aren't part of the manuscript).
 */
export function countWords(text: string): number {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '').replace(/%%[^\n]*?%%/g, '')
  const words = body.trim().match(/\S+/g)
  return words ? words.length : 0
}
