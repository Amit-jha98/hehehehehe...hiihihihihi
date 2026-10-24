import { lazy, Suspense, useEffect, useState } from 'react'
import { ApiState, fmtPub, useApi } from './useApi.jsx'

const DecisionView = lazy(() => import('./DecisionView.jsx'))
const AccuracyView = lazy(() => import('./AccuracyView.jsx'))
const DataView = lazy(() => import('./DataView.jsx'))
const initial = new URLSearchParams(window.location.search)
const views = ['decision', 'accuracy', 'data']
const validCutoff = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '')

export default function App() {
  const request = useApi('/api/meta')
  const [tab, setTab] = useState(
    views.includes(initial.get('view')) ? initial.get('view') : 'decision'
  )
  const [cutoff, setCutoff] = useState(
    validCutoff(initial.get('cutoff')) ? initial.get('cutoff') : '09:00'
  )
  const [day, setDay] = useState(initial.get('date'))
  const [range, setRange] = useState({ start: initial.get('start'), end: initial.get('end') })
  const meta = request.data
  const activeDay = meta?.days.includes(day) ? day : meta?.days[Math.floor(meta.days.length / 2)]
  const headings = {
    decision: 'Day-ahead wind forecast',
    accuracy: 'Forecast accuracy',
    data: 'Data & methodology',
  }

  useEffect(() => {
    if (!meta || !activeDay) return
    const params = new URLSearchParams({ view: tab, date: activeDay, cutoff })
    if (range.start) params.set('start', range.start)
    if (range.end) params.set('end', range.end)
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`)
  }, [meta, tab, activeDay, cutoff, range])

  function inspectDay(date) {
    setDay(date)
    setTab('decision')
    document.getElementById('main-content')?.focus()
    window.scrollTo(0, 0)
  }

  return (
    <div className="application">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="app-header">
        <a className="wordmark" href="/" aria-label="WindWatch home">
          WindWatch
        </a>
        <span className="product-context">GB national wind</span>
        <nav aria-label="Main navigation">
          {[
            ['decision', 'Forecast'],
            ['accuracy', 'Accuracy'],
            ['data', 'Data & methodology'],
          ].map(([id, label]) => (
            <button
              key={id}
              aria-current={tab === id ? 'page' : undefined}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="header-period">
          January 2026 <span>· UTC</span>
        </span>
      </header>
      <main id="main-content" tabIndex={-1}>
        <div className="page-title">
          <div>
            <h1>{headings[tab]}</h1>
            <p>
              {tab === 'decision'
                ? 'Forecasts available at the purchase cutoff, for next-day delivery.'
                : tab === 'accuracy'
                  ? 'Historical error at the same day-ahead purchase cutoff.'
                  : 'Source coverage, publication timestamps and calculation rules.'}
            </p>
          </div>
          {meta && (
            <span className={`data-status ${meta.synthetic ? 'sample' : ''}`}>
              {meta.synthetic ? 'Synthetic sample' : 'Historical Elexon data'}
            </span>
          )}
        </div>
        <ApiState request={request} />
        {meta && (
          <>
            {meta.synthetic && (
              <div className="notice warning" role="status">
                <strong>Synthetic development data</strong>
                <p>These values are generated samples, not Elexon observations.</p>
              </div>
            )}
            {!meta.days.length ? (
              <div className="empty-state">
                <h2>No data in this decision period</h2>
                <p>Import the January 2–February 1 delivery dataset.</p>
              </div>
            ) : (
              <Suspense
                fallback={
                  <div className="loading" role="status">
                    Loading workspace…
                  </div>
                }
              >
                {tab === 'decision' && (
                  <DecisionView
                    meta={meta}
                    cutoff={cutoff}
                    setCutoff={setCutoff}
                    day={activeDay}
                    setDay={setDay}
                  />
                )}
                {tab === 'accuracy' && (
                  <AccuracyView
                    meta={meta}
                    cutoff={cutoff}
                    setCutoff={setCutoff}
                    range={range}
                    setRange={setRange}
                    onInspectDay={inspectDay}
                  />
                )}
                {tab === 'data' && <DataView meta={meta} />}
              </Suspense>
            )}
          </>
        )}
        {meta && (
          <footer className="source-footer">
            <span>
              Elexon BMRS <span aria-hidden="true">/</span> WINDFOR + FUELHH{' '}
              <span aria-hidden="true">·</span> National generation, Great Britain
            </span>
            <span>
              Snapshot retrieved {fmtPub(meta.generated_at === 'n/a' ? null : meta.generated_at)}
            </span>
          </footer>
        )}
      </main>
    </div>
  )
}
