import { useCallback, useEffect, useRef } from 'react'
import { createCodeMirrorAdapter } from '../editor/codemirror-adapter'
import type { EditorAdapter } from '../editor/editor-adapter'
import type { EditorDoc } from '../editor/types'
import { characterCompletionSource, crutchWordDiagnostics } from '../editor/demo-analysis'
import { countWords } from '../lib/text'

export interface EditorStatus {
  words: number
  cursor: { line: number; column: number }
}

interface EditorProps {
  doc: EditorDoc
  vimEnabled: boolean
  diagnosticsEnabled: boolean
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
  onStatus,
  onDocChange,
  revealTarget
}: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<EditorAdapter | null>(null)
  const diagEnabledRef = useRef(diagnosticsEnabled)
  const onStatusRef = useRef(onStatus)
  const onDocChangeRef = useRef(onDocChange)

  // Keep the latest callbacks without re-subscribing the editor.
  useEffect(() => {
    onStatusRef.current = onStatus
    onDocChangeRef.current = onDocChange
  }, [onStatus, onDocChange])

  // Recompute diagnostics (if on) + status. Stable across renders (reads refs).
  const refresh = useCallback((text?: string) => {
    const adapter = adapterRef.current
    if (!adapter) return
    const value = text ?? adapter.getText()
    adapter.setDiagnostics(diagEnabledRef.current ? crutchWordDiagnostics(value) : [])
    onStatusRef.current?.({ words: countWords(value), cursor: adapter.getCursor() })
  }, [])

  // Mount the adapter once.
  useEffect(() => {
    const adapter = createCodeMirrorAdapter()
    adapterRef.current = adapter
    adapter.mount(hostRef.current as HTMLElement)
    adapter.setCompletionSource(characterCompletionSource)
    const off = adapter.onChange((text) => {
      onDocChangeRef.current?.(text)
      refresh(text)
    })
    return () => {
      off()
      adapter.dispose()
      adapterRef.current = null
    }
  }, [refresh])

  // Load the document whenever it changes (also runs on first mount).
  useEffect(() => {
    const adapter = adapterRef.current
    if (!adapter) return
    adapter.loadDoc(doc)
    refresh(doc.text)
  }, [doc, refresh])

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

  // React to the diagnostics toggle.
  useEffect(() => {
    diagEnabledRef.current = diagnosticsEnabled
    refresh()
  }, [diagnosticsEnabled, refresh])

  return <div ref={hostRef} className="editor-host" />
}
