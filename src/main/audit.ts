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
/** Keep the log bounded — trim to the newest N lines when it grows past this. */
const MAX_LINES = 5000
const TRIM_TO = 4000

function logPath(root: string): string {
  return join(root, DIR, FILE)
}

/** Project-relative POSIX path for a log entry. */
export function auditRel(root: string, abs: string): string {
  return relative(root, abs).split(sep).join('/')
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

/** Convenience: log a content write, capturing before/after byte sizes. */
export async function auditWrite(
  root: string,
  abs: string,
  action: AuditAction,
  contents: string,
  prevBytes?: number
): Promise<void> {
  await appendAudit(root, {
    action,
    path: auditRel(root, abs),
    bytes: Buffer.byteLength(contents, 'utf8'),
    prevBytes
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
