import { useMemo, useState } from 'react'
import { Editor, type EditorStatus } from './components/Editor'
import type { EditorDoc } from './editor/types'

// Phase 1 loads the sample-project fixture directly (real file IO arrives in
// Phase 2). `?raw` bundles the Markdown text at build time.
import arrival from '../../../examples/sample-project/manuscript/01-arrival.md?raw'
import offer from '../../../examples/sample-project/manuscript/02-the-offer.md?raw'
import betrayal from '../../../examples/sample-project/manuscript/03-betrayal.md?raw'

const SAMPLE_FILES = [
  {
    uri: 'examples/sample-project/manuscript/01-arrival.md',
    label: '01 · Arrival',
    text: arrival
  },
  {
    uri: 'examples/sample-project/manuscript/02-the-offer.md',
    label: '02 · The Offer',
    text: offer
  },
  {
    uri: 'examples/sample-project/manuscript/03-betrayal.md',
    label: '03 · Betrayal',
    text: betrayal
  }
]

export default function App() {
  const [fileIndex, setFileIndex] = useState(0)
  const [vim, setVim] = useState(false)
  const [diagnostics, setDiagnostics] = useState(false)
  const [status, setStatus] = useState<EditorStatus>({
    words: 0,
    cursor: { line: 1, column: 1 }
  })

  const file = SAMPLE_FILES[fileIndex]
  const doc = useMemo<EditorDoc>(
    () => ({ uri: file.uri, text: file.text }),
    [file.uri, file.text]
  )

  return (
    <div className="app">
      <header className="toolbar">
        <div className="toolbar__group">
          {SAMPLE_FILES.map((f, i) => (
            <button
              key={f.uri}
              className={`tab${i === fileIndex ? ' tab--active' : ''}`}
              onClick={() => setFileIndex(i)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="toolbar__group">
          <button
            className={`toggle${vim ? ' toggle--on' : ''}`}
            onClick={() => setVim((v) => !v)}
          >
            Vim: {vim ? 'on' : 'off'}
          </button>
          <button
            className={`toggle${diagnostics ? ' toggle--on' : ''}`}
            onClick={() => setDiagnostics((d) => !d)}
          >
            Diagnostics: {diagnostics ? 'on' : 'off'}
          </button>
        </div>
      </header>

      <Editor
        doc={doc}
        vimEnabled={vim}
        diagnosticsEnabled={diagnostics}
        onStatus={setStatus}
      />

      <footer className="statusbar">
        <span>{file.uri.split('/').pop()}</span>
        <span>{status.words} words</span>
        <span>
          Ln {status.cursor.line}, Col {status.cursor.column}
        </span>
        <span className="statusbar__hint">
          Type <code>@</code> for characters · Vim {vim ? 'on' : 'off'} · Diagnostics{' '}
          {diagnostics ? 'on' : 'off'}
        </span>
      </footer>
    </div>
  )
}
