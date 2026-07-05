/** Count words in Markdown prose, ignoring a leading YAML frontmatter block. */
export function countWords(text: string): number {
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, '')
  const words = body.trim().match(/\S+/g)
  return words ? words.length : 0
}
