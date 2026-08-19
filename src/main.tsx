import { Component, StrictMode } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Last-resort error boundary: a render crash anywhere in the tree shows a
// readable message + reload button instead of a silent black screen.
// Inline styles on purpose — it must render even if the stylesheet failed.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled render error:', error, info)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
            background: '#0f172a',
            color: '#e2e8f0',
            fontFamily: 'ui-sans-serif, system-ui, sans-serif',
            padding: '24px',
            textAlign: 'center',
          }}
        >
          <h1 style={{ fontSize: '18px', fontWeight: 600, margin: 0 }}>Something went wrong</h1>
          <pre
            style={{
              maxWidth: '640px',
              overflow: 'auto',
              whiteSpace: 'pre-wrap',
              background: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              padding: '12px',
              fontSize: '12px',
              color: '#fca5a5',
              textAlign: 'left',
            }}
          >
            {String(this.state.error?.message || this.state.error)}
          </pre>
          <p style={{ fontSize: '12px', color: '#94a3b8', margin: 0 }}>
            Your saved library and settings are kept in this browser; reloading is safe.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: '8px',
              padding: '8px 16px',
              fontSize: '13px',
              cursor: 'pointer',
            }}
          >
            Reload the app
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
