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
}

export function Editor({ doc, vimEnabled, diagnosticsEnabled, onStatus }: EditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const adapterRef = useRef<EditorAdapter | null>(null)
  const diagEnabledRef = useRef(diagnosticsEnabled)
  const onStatusRef = useRef(onStatus)

  // Keep the latest onStatus callback without re-subscribing the editor.
  useEffect(() => {
    onStatusRef.current = onStatus
  }, [onStatus])

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
    const off = adapter.onChange((text) => refresh(text))
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
