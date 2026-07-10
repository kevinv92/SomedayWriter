import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { createCodeMirrorAdapter } from '../editor/codemirror-adapter'
import type { EditorAdapter, FormatAction } from '../editor/editor-adapter'
import type { EditorDoc } from '../editor/types'
import type { AnalysisService } from '../analysis/analysis-service'
import { countWords } from '../lib/text'

export interface EditorStatus {
  words: number
  cursor: { line: number; column: number }
}

/** Imperative handle for actions that need live editor state (go-to-definition
 * from the command palette, which reads the cursor while the editor is unfocused). */
export interface EditorHandle {
  /** The cursor line's text + 1-based column, or null before mount. */
  cursorContext(): { lineText: string; column: number } | null
  /** Apply a Markdown formatting action to the current selection (toolbar). */
  format(action: FormatAction): void
  /** Accept/reject the tracked change under the cursor. */
  resolveChange(accept: boolean): void
  /** Tidy the Markdown table around the cursor. */
  formatTable(): void
  /** Insert a Markdown image at the cursor. */
  insertImage(alt: string, src: string): void
  /** Replace a character range (used by the frontmatter editor to write the
   *  `---` block back minimally, preserving the body cursor + undo history). */
  replaceRange(from: number, to: number, insert: string): void
}

interface EditorProps {
  doc: EditorDoc
  vimEnabled: boolean
  /** Vim j/k move by display line (gj/gk) — for wrapped prose. */
  vimWrapMotion: boolean
  diagnosticsEnabled: boolean
  /** The analysis facade — supplies completions (pull) and diagnostics (push).
   * The editor never talks to a provider directly (SPEC seam). */
  analysis: AnalysisService
  onStatus?: (status: EditorStatus) => void
  /** Fires the current Vim mode ('normal' | 'insert' | 'visual' | 'replace', or
   * '' when Vim is off) — drives the status-bar mode chip. */
  onVimMode?: (mode: string) => void
  /** Fires the full document text on every edit (drives dirty/save in App). */
  onDocChange?: (text: string) => void
  /** When set, scroll to this 1-based line/column (jump to a search match or a
   * reference). An `endColumn` selects the span so it's highlighted. The `nonce`
   * forces re-reveal even when the same line is targeted twice. */
  revealTarget?: {
    line: number
    column: number
    endColumn?: number
    nonce: number
  } | null
  /** Go-to-definition: fired on Cmd/Ctrl+click with the clicked line's text and
   * 1-based column. App resolves the entity (StoryIndex) and opens its profile. */
  onGoToDefinition?: (lineText: string, column: number) => void
  /** Resolve a mention's char range at (lineText, 1-based column) — drives the
   * ⌘/Ctrl-hover "clickable" underline. */
  onResolveMention?: (
    lineText: string,
    column: number
  ) => { from: number; to: number } | null
  /** Filled with an imperative handle so App can read the cursor for a
   * palette-triggered go-to-definition (see EditorHandle). */
  handleRef?: RefObject<EditorHandle | null>
  /** The active file's project-relative directory (resolves image paths). */
  assetDir?: string
  /** Image files dropped onto the editor (absolute source paths) — App imports
   * them into the project and inserts the Markdown. */
  onImageDropped?: (sourcePaths: string[]) => void
}

export function Editor({
  doc,
  vimEnabled,
  vimWrapMotion,
  diagnosticsEnabled,
  analysis,
  onStatus,
  onVimMode,
  onDocChange,
  revealTarget,
  onGoToDefinition,
  onResolveMention,
  handleRef,
  assetDir,
  onImageDropped
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<EditorAdapter | null>(null)
  const onStatusRef = useRef(onStatus)
  const onVimModeRef = useRef(onVimMode)
  const onDocChangeRef = useRef(onDocChange)
  const onGoToDefinitionRef = useRef(onGoToDefinition)
  const onResolveMentionRef = useRef(onResolveMention)
  const onImageDroppedRef = useRef(onImageDropped)
  const docUriRef = useRef(doc.uri)
  // Current Vim prefs, so a (re)mounted adapter can apply them immediately — the
  // separate `[vimEnabled]` effect below only fires on *change*, so without this a
  // fresh adapter (e.g. a StrictMode dev remount) would default to Vim-off while
  // settings say on. Kept in refs to avoid remounting the editor on every toggle.
  const vimEnabledRef = useRef(vimEnabled)
  const vimWrapMotionRef = useRef(vimWrapMotion)
  useEffect(() => {
    vimEnabledRef.current = vimEnabled
    vimWrapMotionRef.current = vimWrapMotion
  })

  // Keep the latest callbacks without re-subscribing the editor.
  useEffect(() => {
    onStatusRef.current = onStatus
    onVimModeRef.current = onVimMode
    onDocChangeRef.current = onDocChange
    onGoToDefinitionRef.current = onGoToDefinition
    onResolveMentionRef.current = onResolveMention
    onImageDroppedRef.current = onImageDropped
  }, [
    onStatus,
    onVimMode,
    onDocChange,
    onGoToDefinition,
    onResolveMention,
    onImageDropped
  ])

  // Word count + cursor for the status bar. Diagnostics no longer computed here —
  // they arrive from the facade.
  const emitStatus = useCallback((text?: string) => {
    const adapter = adapterRef.current
    if (!adapter) return
    const value = text ?? adapter.getText()
    onStatusRef.current?.({ words: countWords(value), cursor: adapter.getCursor() })
  }, [])

  // Mount the adapter once and wire it to the analysis facade.
  useEffect(() => {
    const adapter = createCodeMirrorAdapter()
    adapterRef.current = adapter
    adapter.mount(hostRef.current as HTMLElement)
    // Apply the current Vim prefs to the fresh adapter (it defaults to off).
    adapter.setVimMode(vimEnabledRef.current)
    adapter.setVimWrapMotion(vimWrapMotionRef.current)
    adapter.setCompletionSource(analysis.completionSource)
    adapter.setGoToDefinition((ctx) =>
      onGoToDefinitionRef.current?.(ctx.lineText, ctx.column)
    )
    adapter.setMentionResolver(
      (lineText, column) => onResolveMentionRef.current?.(lineText, column) ?? null
    )
    if (handleRef) {
      handleRef.current = {
        cursorContext: () => adapter.getCursorContext(),
        format: (action) => adapter.format(action),
        resolveChange: (accept) => adapter.resolveChange(accept),
        formatTable: () => adapter.formatTable(),
        insertImage: (alt, src) => adapter.insertImage(alt, src),
        replaceRange: (from, to, insert) => adapter.replaceRange(from, to, insert)
      }
    }
    const offDiagnostics = analysis.onDiagnostics((uri, diags) => {
      if (uri === docUriRef.current) adapter.setDiagnostics(diags)
    })
    const offChange = adapter.onChange((text) => {
      onDocChangeRef.current?.(text)
      analysis.update({ uri: docUriRef.current, text })
      emitStatus(text)
    })
    const offVimMode = adapter.onVimModeChange((mode) => onVimModeRef.current?.(mode))
    return () => {
      offChange()
      offVimMode()
      offDiagnostics()
      adapter.dispose()
      adapterRef.current = null
      if (handleRef) handleRef.current = null
    }
  }, [analysis, emitStatus, handleRef])

  // Load the document whenever it changes (also runs on first mount).
  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter) return
    docUriRef.current = doc.uri
    adapter.loadDoc(doc)
    analysis.update({ uri: doc.uri, text: doc.text })
    emitStatus(doc.text)
  }, [doc, analysis, emitStatus])

  // Jump to a search match. Runs after the load effect above (same commit) so
  // the doc is in place; `nonce` in the dep re-fires it for repeat targets.
  useEffect(() => {
    if (!revealTarget) return
    const adapter = adapterRef.current
    adapter?.focusLine(revealTarget.line, revealTarget.column, revealTarget.endColumn)
    // The jump moves the cursor without a doc change, so refresh the status bar
    // (line/column) to match where we landed.
    emitStatus()
    // A caret-only reveal (no endColumn) means we're landing here to type — Quick
    // Open or a comment jump. The overlay that triggered it is unmounting around
    // this commit, and its focused input steals focus back on removal — but the
    // exact frame it does so is timing-dependent (a single next-frame re-focus
    // wins on a fast machine and loses on a slow one, which is why "I have to
    // click the editor" kept recurring). So re-assert focus every frame across a
    // short window, re-grabbing whenever the editor isn't focused, until it
    // sticks. (Search / reference reveals pass endColumn and keep panel focus, so
    // skip those.)
    if (revealTarget.endColumn == null && adapter) {
      let raf = 0
      let frames = 0
      let stable = 0
      // Re-grab focus until it *holds* for a few consecutive frames — the overlay
      // input steals it back on unmount, and on a slow (dev) build that steal can
      // land well after a fixed ~200ms window, so a frame count alone kept losing
      // the race. Stop once focus sticks (~100ms) or a generous ceiling (~0.75s).
      const MAX_FRAMES = 45
      const STABLE_NEEDED = 6
      const grab = (): void => {
        if (adapter.hasFocus()) {
          if (++stable >= STABLE_NEEDED) return
        } else {
          adapter.focus()
          stable = 0
        }
        if (++frames < MAX_FRAMES) raf = requestAnimationFrame(grab)
      }
      grab()
      return () => cancelAnimationFrame(raf)
    }
    return
  }, [revealTarget, emitStatus])

  // React to the Vim toggle.
  useEffect(() => {
    adapterRef.current?.setVimMode(vimEnabled)
  }, [vimEnabled])

  // Display-line motion (gj/gk) preference.
  useEffect(() => {
    adapterRef.current?.setVimWrapMotion(vimWrapMotion)
  }, [vimWrapMotion])

  // Diagnostics on/off is owned by the facade (off by default).
  useEffect(() => {
    analysis.setDiagnosticsEnabled(diagnosticsEnabled)
  }, [diagnosticsEnabled, analysis])

  // Resolve image paths relative to the active file's folder.
  useEffect(() => {
    adapterRef.current?.setAssetDir(assetDir ?? '')
  }, [assetDir])

  // Drag-and-drop image files → import into the project + insert Markdown.
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const isImage = (f: File): boolean => /^image\//.test(f.type)
    const onDrop = (e: DragEvent): void => {
      const files = Array.from(e.dataTransfer?.files ?? []).filter(isImage)
      if (!files.length) return
      e.preventDefault()
      const paths = files
        .map((f) => (f as File & { path?: string }).path)
        .filter((p): p is string => !!p)
      if (paths.length) onImageDroppedRef.current?.(paths)
    }
    const onDragOver = (e: DragEvent): void => {
      if (
        Array.from(e.dataTransfer?.items ?? []).some((i) => i.type.startsWith('image/'))
      ) {
        e.preventDefault()
      }
    }
    host.addEventListener('drop', onDrop)
    host.addEventListener('dragover', onDragOver)
    return () => {
      host.removeEventListener('drop', onDrop)
      host.removeEventListener('dragover', onDragOver)
    }
  }, [])

  return <div ref={hostRef} className="editor-host" />
}
