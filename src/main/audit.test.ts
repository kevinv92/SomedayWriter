import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendAudit,
  auditRel,
  auditWrite,
  backupBefore,
  readAudit,
  restoreBackup
} from './audit'

function tmpRoot(): Promise<string> {
  return fs.mkdtemp(join(tmpdir(), 'sw-audit-'))
}

describe('audit log', () => {
  it('returns [] when there is no log yet', async () => {
    expect(await readAudit(await tmpRoot())).toEqual([])
  })

  it('appends entries and reads them back newest-first, with a timestamp', async () => {
    const root = await tmpRoot()
    await appendAudit(root, { action: 'create', path: 'a.md', bytes: 0 })
    await appendAudit(root, { action: 'save', path: 'a.md', bytes: 100, prevBytes: 0 })
    const entries = await readAudit(root)
    expect(entries).toHaveLength(2)
    expect(entries[0].action).toBe('save') // newest first
    expect(entries[1].action).toBe('create')
    expect(entries[0].prevBytes).toBe(0)
    expect(typeof entries[0].ts).toBe('string')
  })

  it('auditWrite captures byte sizes and a project-relative POSIX path', async () => {
    const root = await tmpRoot()
    await auditWrite(root, join(root, 'scenes', 'one.md'), 'save', 'hello', 900)
    const [e] = await readAudit(root)
    expect(e).toMatchObject({
      action: 'save',
      path: 'scenes/one.md',
      bytes: 5,
      prevBytes: 900
    })
  })

  it('stores the log inside .somedaywriter/audit.jsonl', async () => {
    const root = await tmpRoot()
    await appendAudit(root, { action: 'save', path: 'x.md', bytes: 1 })
    const raw = await fs.readFile(join(root, '.somedaywriter', 'audit.jsonl'), 'utf8')
    expect(raw.trim().split('\n')).toHaveLength(1)
    expect(JSON.parse(raw)).toMatchObject({ action: 'save', path: 'x.md', bytes: 1 })
  })

  it('skips a corrupt line rather than failing the whole read', async () => {
    const root = await tmpRoot()
    await appendAudit(root, { action: 'save', path: 'ok.md', bytes: 2 })
    await fs.appendFile(join(root, '.somedaywriter', 'audit.jsonl'), 'not json\n', 'utf8')
    const entries = await readAudit(root)
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe('ok.md')
  })

  it('auditRel returns a project-relative path', () => {
    expect(auditRel('/root', '/root/a/b.md')).toBe('a/b.md')
  })

  it('backs up content and restores it (the recovery path)', async () => {
    const root = await tmpRoot()
    const abs = join(root, 'core', 'story.md')
    await fs.mkdir(join(root, 'core'), { recursive: true })
    await fs.writeFile(abs, 'the real manuscript', 'utf8')

    const backup = await backupBefore(root, abs)
    expect(backup).toBeTruthy()
    expect(backup?.startsWith('backups/core/story.md/')).toBe(true)

    // A bad overwrite clobbers the file…
    await fs.writeFile(abs, 'oops', 'utf8')
    expect(await fs.readFile(abs, 'utf8')).toBe('oops')

    // …and the backup brings it back.
    expect(await restoreBackup(root, backup as string, abs)).toBe(true)
    expect(await fs.readFile(abs, 'utf8')).toBe('the real manuscript')
  })

  it('backupBefore returns undefined when there is nothing to back up', async () => {
    const root = await tmpRoot()
    expect(await backupBefore(root, join(root, 'missing.md'))).toBeUndefined()
  })
})
