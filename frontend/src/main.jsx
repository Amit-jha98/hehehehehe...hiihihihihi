import React from 'react'
import { createRoot } from 'react-dom/client'
import { Analytics } from '@vercel/analytics/react'
import App from './App.jsx'
import './styles.css'

class ErrorBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(error) {
    console.error('WindWatch rendering error', error)
  }
  render() {
    if (this.state.failed)
      return (
        <main>
          <div className="notice danger" role="alert">
            <div>
              <strong>The workspace could not be displayed.</strong>
              <p>Reload the page to try again.</p>
            </div>
            <button className="button" onClick={() => window.location.reload()}>
              Reload
            </button>
          </div>
        </main>
      )
    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
      <Analytics />
    </ErrorBoundary>
  </React.StrictMode>
)
