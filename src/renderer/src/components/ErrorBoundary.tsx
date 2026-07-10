import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  children: ReactNode
}
interface State {
  error: Error | null
}

/**
 * Catches render/runtime errors in the tree so a single component throwing shows
 * a recoverable panel instead of blanking the **whole** app (a white screen with
 * no way back). The message + a Reload button let the user recover, and the error
 * is logged for diagnosis.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('App error boundary caught:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div className="crash">
        <div className="crash__box">
          <h1 className="crash__title">Something went wrong</h1>
          <p className="crash__msg">
            The app hit an error, but your files on disk are untouched.
          </p>
          <pre className="crash__detail">{error.message}</pre>
          <div className="crash__actions">
            <button className="crash__btn" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button className="crash__btn" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </div>
      </div>
    )
  }
}
