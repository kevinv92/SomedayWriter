import { useCallback, useEffect, useRef } from 'react'
import { createCodeMirrorAdapter } from '../editor/codemirror-adapter'
import type { EditorAdapter } from '../editor/editor-adapter'
import type { EditorDoc } from '../editor/types'
import type { AnalysisService } from '../analysis/analysis-service'
import { countWords } from '../lib/text'

export interface EditorStatus {
  words: number
  cursor: { line: number; column: number }
}

interface EditorProps {
  doc: EditorDoc
  vimEnabled: boolean
  diagnosticsEnabled: boolean
  /** The analysis facade — supplies completions (pull) and diagnostics (push).
   * The editor never talks to a provider directly (SPEC seam). */
  analysis: AnalysisService
  onStatus?: (status: EditorStatus) => void
  /** Fires the full document text on every edit (drives dirty/save in App). */
  onDocChange?: (text: string) => void
  /** When set, scroll to and place the cursor at this 1-based line/column (used
   * to jump to a project-search match). The `nonce` forces re-reveal even when
   * the same line is targeted twice. */
  revealTarget?: { line: number; column: number; nonce: number } | null
}

export function Editor({
  doc,
  vimEnabled,
  diagnosticsEnabled,
  analysis,
  onStatus,
  onDocChange,
  revealTarget
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<EditorAdapter | null>(null)
  const onStatusRef = useRef(onStatus)
  const onDocChangeRef = useRef(onDocChange)
  const docUriRef = useRef(doc.uri)

  // Keep the latest callbacks without re-subscribing the editor.
  useEffect(() => {
    onStatusRef.current = onStatus
    onDocChangeRef.current = onDocChange
  }, [onStatus, onDocChange])

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
    const offDiagnostics = analysis.onDiagnostics((uri, diags) => {
      if (uri === docUriRef.current) adapter.setDiagnostics(diags)
    })
    const offChange = adapter.onChange((text) => {
      onDocChangeRef.current?.(text)
      analysis.update({ uri: docUriRef.current, text })
      emitStatus(text)
    })
    return () => {
      offChange()
      offDiagnostics()
      adapter.dispose()
      adapterRef.current = null
    }
  }, [analysis, emitStatus])

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
    adapterRef.current?.focusLine(revealTarget.line, revealTarget.column)
  }, [revealTarget])

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
