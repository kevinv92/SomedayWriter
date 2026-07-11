/**
 * Per-project activity/audit log. Every write the app makes to a project file is
 * appended here as one JSON line, so a lost or shrunken file is traceable after
 * the fact — a local-first safety net for prose. Lives *inside* the project
 * (`.somedaywriter/audit.jsonl`) so it travels with the manuscript.
 *
 * Logging must NEVER break a real write: every function swallows its own errors.
 */
import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { AuditAction, AuditEntry } from '../shared/types'

const DIR = '.somedaywriter'
const FILE = 'audit.jsonl'
const BACKUP_DIR = 'backups'
/** Keep the log bounded — trim to the newest N lines when it grows past this. */
const MAX_LINES = 5000
const TRIM_TO = 4000
/** How many pre-write backups to keep per file. */
const KEEP_BACKUPS = 15

function logPath(root: string): string {
  return join(root, DIR, FILE)
}

/** Project-relative POSIX path for a log entry. */
export function auditRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
}

/**
 * Copy a file's current on-disk content to a timestamped backup *before* it's
 * overwritten/deleted, so the write is recoverable. Returns the backup's path
 * relative to `.somedaywriter/` (for the audit entry), or undefined if there was
 * nothing to back up (new file) or it failed — best-effort, never throws.
 */
export async function backupBefore(
  root: string,
  abs: string
): Promise<string | undefined> {
  try {
    const content = await fs.readFile(abs) // Buffer — preserve exact bytes
    const rel = auditRel(root, abs)
    const dir = join(root, DIR, BACKUP_DIR, rel)
    await fs.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.writeFile(join(dir, `${stamp}.bak`), content)
    // Prune to the newest KEEP_BACKUPS (timestamp names sort lexically = chrono).
    const kept = (await fs.readdir(dir)).filter((f) => f.endsWith('.bak')).sort()
    for (const old of kept.slice(0, Math.max(0, kept.length - KEEP_BACKUPS))) {
      await fs.rm(join(dir, old)).catch(() => {})
    }
    return `${BACKUP_DIR}/${rel}/${stamp}.bak`
  } catch {
    return undefined
  }
}

/** Restore a backup (path relative to `.somedaywriter/`) onto a target file. */
export async function restoreBackup(
  root: string,
  backupRel: string,
  targetAbs: string
): Promise<boolean> {
  try {
    const content = await fs.readFile(join(root, DIR, backupRel))
    await fs.writeFile(targetAbs, content)
    return true
  } catch {
    return false
  }
}

/** Append one entry. Best-effort: any failure is swallowed. */
export async function appendAudit(
  root: string,
  entry: Omit<AuditEntry, 'ts'>
): Promise<void> {
  try {
    await fs.mkdir(join(root, DIR), { recursive: true })
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n'
    await fs.appendFile(logPath(root), line, 'utf8')
    await trimIfLarge(root)
  } catch {
    /* never let logging break a save */
  }
}

/** Convenience: log a content write, capturing before/after byte sizes and the
 *  pre-write backup (if one was taken). */
export async function auditWrite(
  root: string,
  abs: string,
  action: AuditAction,
  contents: string,
  prevBytes?: number,
  backup?: string
): Promise<void> {
  await appendAudit(root, {
    action,
    path: auditRel(root, abs),
    bytes: Buffer.byteLength(contents, 'utf8'),
    prevBytes,
    backup
  })
}

/** The newest `limit` entries, newest first. Empty if there's no log yet. */
export async function readAudit(root: string, limit = 500): Promise<AuditEntry[]> {
  try {
    const text = await fs.readFile(logPath(root), 'utf8')
    const lines = text.split('\n').filter(Boolean).slice(-limit)
    const out: AuditEntry[] = []
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as AuditEntry)
      } catch {
        /* skip a corrupt line rather than fail the whole read */
      }
    }
    return out.reverse()
  } catch {
    return []
  }
}

/** Trim the log to its newest lines once it grows too large. */
async function trimIfLarge(root: string): Promise<void> {
  try {
    const text = await fs.readFile(logPath(root), 'utf8')
    const lines = text.split('\n').filter(Boolean)
    if (lines.length <= MAX_LINES) return
    await fs.writeFile(logPath(root), lines.slice(-TRIM_TO).join('\n') + '\n', 'utf8')
  } catch {
    /* ignore */
  }
}
