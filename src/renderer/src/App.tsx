import { useEffect, useState } from 'react'

type PingState = 'pending' | 'ok' | 'error'

export default function App() {
  const [state, setState] = useState<PingState>('pending')
  const [reply, setReply] = useState<string>('…')

  useEffect(() => {
    window.api
      .ping()
      .then((res) => {
        setReply(res)
        setState('ok')
      })
      .catch((err: unknown) => {
        setReply(String(err))
        setState('error')
      })
  }, [])

  return (
    <main className="shell">
      <h1>writer-gui</h1>
      <p className="tagline">Phase 0 — scaffold</p>
      <p className={`ipc ipc--${state}`}>
        IPC bridge: <code>window.api.ping()</code> → <strong>{reply}</strong>
        {state === 'ok' && ' ✓'}
      </p>
    </main>
  )
}
