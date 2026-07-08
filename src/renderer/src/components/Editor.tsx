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
}

interface EditorProps {
  doc: EditorDoc
  vimEnabled: boolean
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
  /** Filled with an imperative handle so App can read the cursor for a
   * palette-triggered go-to-definition (see EditorHandle). */
  handleRef?: RefObject<EditorHandle | null>
}

export function Editor({
  doc,
  vimEnabled,
  diagnosticsEnabled,
  analysis,
  onStatus,
  onVimMode,
  onDocChange,
  revealTarget,
  onGoToDefinition,
  handleRef
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<EditorAdapter | null>(null)
  const onStatusRef = useRef(onStatus)
  const onVimModeRef = useRef(onVimMode)
  const onDocChangeRef = useRef(onDocChange)
  const onGoToDefinitionRef = useRef(onGoToDefinition)
  const docUriRef = useRef(doc.uri)

  // Keep the latest callbacks without re-subscribing the editor.
  useEffect(() => {
    onStatusRef.current = onStatus
    onVimModeRef.current = onVimMode
    onDocChangeRef.current = onDocChange
    onGoToDefinitionRef.current = onGoToDefinition
  }, [onStatus, onVimMode, onDocChange, onGoToDefinition])

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
    adapter.setCompletionSource(analysis.completionSource)
    adapter.setGoToDefinition((ctx) =>
      onGoToDefinitionRef.current?.(ctx.lineText, ctx.column)
    )
    if (handleRef) {
      handleRef.current = {
        cursorContext: () => adapter.getCursorContext(),
        format: (action) => adapter.format(action)
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
    adapterRef.current?.focusLine(
      revealTarget.line,
      revealTarget.column,
      revealTarget.endColumn
    )
    // The jump moves the cursor without a doc change, so refresh the status bar
    // (line/column) to match where we landed.
    emitStatus()
  }, [revealTarget, emitStatus])

  // React to the Vim toggle.
  useEffect(() => {
    adapterRef.current?.setVimMode(vimEnabled)
  }, [vimEnabled])

  // Diagnostics on/off is owned by the facade (off by default).
  useEffect(() => {
    analysis.setDiagnosticsEnabled(diagnosticsEnabled)
  }, [diagnosticsEnabled, analysis])

  return <div ref={hostRef} className="editor-host" />
}
