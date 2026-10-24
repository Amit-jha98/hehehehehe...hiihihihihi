import { useCallback, useEffect, useState } from 'react'

export function useApi(url) {
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState({ url: null, data: null, error: null, loading: true })
  const retry = useCallback(() => setRevision((v) => v + 1), [])
  useEffect(() => {
    if (!url) return
    const controller = new AbortController()
    setState({ url, data: null, error: null, loading: true })
    fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => null)
        if (!response.ok)
          throw new Error(
            typeof body?.detail === 'string' ? body.detail : `Request failed (${response.status}).`
          )
        if (!body) throw new Error('The server returned an invalid response.')
        return body
      })
      .then((data) => {
        if (!controller.signal.aborted) setState({ url, data, error: null, loading: false })
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ url, data: null, error: error.message, loading: false })
      })
    return () => controller.abort()
  }, [url, revision])
  const current = state.url === url ? state : { data: null, error: null, loading: Boolean(url) }
  return { ...current, retry }
}

export const mw = (value) =>
  value == null || !Number.isFinite(Number(value))
    ? '\u2014'
    : Math.round(value).toLocaleString('en-GB')
export const pct = (value) =>
  value == null ? '\u2014' : `${value.toLocaleString('en-GB', { maximumFractionDigits: 2 })}%`
export const fmtTime = (iso) => iso.slice(11, 16)
export const fmtPub = (iso) => (iso ? `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC` : '\u2014')
export const previousDay = (day) =>
  new Date(Date.parse(`${day}T12:00:00Z`) - 86400000).toISOString().slice(0, 10)
export const shortDate = (iso) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(
    new Date(`${iso}T12:00:00Z`)
  )

export function ApiState({ request, label = 'Loading wind data' }) {
  if (request.error)
    return (
      <div className="notice danger" role="alert">
        <div>
          <strong>Unable to load data</strong>
          <p>{request.error}</p>
        </div>
        <button className="button" onClick={request.retry}>
          Try again
        </button>
      </div>
    )
  if (request.loading)
    return (
      <div className="loading" role="status">
        <span className="spinner" />
        {label}…
      </div>
    )
  return null
}
