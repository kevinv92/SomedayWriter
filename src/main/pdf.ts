/**
 * PDF export — render the manuscript HTML with Chromium and print it. Reuses the
 * shared reading stylesheet (manuscript-html.ts); page size/margins are applied
 * here via `printToPDF`, so the same HTML prints at any size. No extra deps.
 */
import { BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export interface PdfOptions {
  pageSize: 'A4' | 'Letter'
  margins: 'normal' | 'wide'
}

/** Render a full HTML document to a PDF Buffer via an offscreen window. */
export async function buildPdf(html: string, opts: PdfOptions): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { javascript: false, sandbox: true }
  })
  // A temp file avoids data:-URL size limits on a book-length manuscript.
  const file = join(tmpdir(), `sw-export-${randomUUID()}.html`)
  try {
    await fs.writeFile(file, html, 'utf8')
    await win.loadFile(file)
    const inches = opts.margins === 'wide' ? 1.5 : 1
    const data = await win.webContents.printToPDF({
      pageSize: opts.pageSize,
      printBackground: true,
      margins: { top: inches, bottom: inches, left: inches, right: inches }
    })
    return data
  } finally {
    if (!win.isDestroyed()) win.destroy()
    await fs.unlink(file).catch(() => {})
  }
}
