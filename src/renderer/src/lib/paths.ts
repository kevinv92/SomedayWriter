/**
 * String-based path helpers for the renderer, which has no Node `path` module.
 * Paths come from the main process as absolute OS paths (either `/` or `\`
 * separated); these tolerate both. Main normalizes on the next tree read.
 */

const SEP_RE = /[\\/]/

export function basename(path: string): string {
  return path.split(SEP_RE).pop() ?? path
}

export function parentDir(path: string): string {
  const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return idx <= 0 ? path : path.slice(0, idx)
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`
}

/** True if `path` is `dir` itself or nested under it. */
export function isInsideDir(path: string, dir: string): boolean {
  return path === dir || path.startsWith(`${dir}/`) || path.startsWith(`${dir}\\`)
}
