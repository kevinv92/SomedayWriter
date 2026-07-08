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

/** `absPath` as a project-relative POSIX path (for image asset resolution). */
export function projectRelative(root: string, absPath: string): string {
  const rel = isInsideDir(absPath, root) ? absPath.slice(root.length + 1) : absPath
  return rel.split(SEP_RE).join('/')
}

/** The POSIX directory of a project-relative file path ('' for a root file). */
export function posixDir(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}

/** Resolve a POSIX `rel` path against POSIX `baseDir`, collapsing `.`/`..`. */
export function posixResolve(baseDir: string, rel: string): string {
  const stack: string[] = []
  for (const part of `${baseDir}/${rel}`.split('/')) {
    if (!part || part === '.') continue
    if (part === '..') stack.pop()
    else stack.push(part)
  }
  return stack.join('/')
}

/** A POSIX relative path from `fromDir` to `to` (both project-relative POSIX). */
export function posixRelativePath(fromDir: string, to: string): string {
  const f = fromDir ? fromDir.split('/') : []
  const t = to.split('/')
  let i = 0
  while (i < f.length && i < t.length && f[i] === t[i]) i++
  return [...f.slice(i).map(() => '..'), ...t.slice(i)].join('/') || '.'
}
