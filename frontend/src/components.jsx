import { useId } from 'react'

export function Icon({ name, size = 16 }) {
  const paths = {
    left: <path d="m14 6-6 6 6 6" />,
    right: <path d="m10 6 6 6-6 6" />,
    download: (
      <>
        <path d="M12 3v12m-4-4 4 4 4-4" />
        <path d="M4 16v4h16v-4" />
      </>
    ),
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  )
}

export function CutoffControl({ value, onChange }) {
  const id = useId()
  return (
    <div className="field cutoff-field">
      <label htmlFor={id}>
        Purchase cutoff <span>UTC</span>
      </label>
      <input
        id={id}
        aria-label="Decision cutoff UTC"
        type="time"
        required
        value={value}
        onChange={(e) =>
          /^([01]\d|2[0-3]):[0-5]\d$/.test(e.target.value) && onChange(e.target.value)
        }
      />
    </div>
  )
}

export function Metric({ label, value, unit, detail, className = '' }) {
  return (
    <div className={`metric ${className}`}>
      <dt>{label}</dt>
      <dd className="metric-number">
        {value}
        {unit && <span className="metric-unit">{unit}</span>}
      </dd>
      {detail && <dd className="metric-detail">{detail}</dd>}
    </div>
  )
}

export function ViewSwitch({ value, onChange, label = 'Display' }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {['chart', 'table'].map((mode) => (
        <button key={mode} aria-pressed={value === mode} onClick={() => onChange(mode)}>
          {mode === 'chart' ? 'Chart' : 'Table'}
        </button>
      ))}
    </div>
  )
}

export function SortHeader({ label, field, sort, onSort, first = false }) {
  return (
    <th
      scope="col"
      className={first ? 'text-column' : ''}
      aria-sort={
        sort.field === field ? (sort.direction === 1 ? 'ascending' : 'descending') : 'none'
      }
    >
      <button className="sort-button" onClick={() => onSort(field)} aria-label={`Sort by ${label}`}>
        {label}
        <span aria-hidden="true">
          {sort.field === field ? (sort.direction === 1 ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  )
}

export function sortedRows(rows, sort) {
  return [...rows].sort((a, b) => {
    const x = a[sort.field],
      y = b[sort.field]
    if (x == null && y == null) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.direction
  })
}

export function nextSort(previous, field) {
  return { field, direction: previous.field === field ? -previous.direction : 1 }
}

export function downloadCsv(filename, columns, rows) {
  const cell = (value) => (value == null ? '' : `"${String(value).replaceAll('"', '""')}"`)
  const text = [columns, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
