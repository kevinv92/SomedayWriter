import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import './index.css'

// The renderer is a single-page app and must NEVER navigate. A native drag/drop
// landing anywhere on the window — e.g. after panning a pane, or a file dropped
// onto a non-editor area — would otherwise make the browser open the dropped
// content and blank the whole app. Swallow the browser default for drops/dragover
// globally (capture phase). This only cancels the default navigation; the editor's
// image-drop and the tree's drag-reorder handlers still run and read the data.
const swallowDrop = (e: DragEvent): void => e.preventDefault()
window.addEventListener('dragover', swallowDrop, { capture: true })
window.addEventListener('drop', swallowDrop, { capture: true })

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
