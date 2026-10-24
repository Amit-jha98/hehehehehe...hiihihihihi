import { useState } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  ComposedChart,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from 'recharts'
import { ApiState, mw, pct, previousDay, shortDate, useApi } from './useApi.jsx'
import {
  CutoffControl,
  downloadCsv,
  Icon,
  Metric,
  nextSort,
  sortedRows,
  SortHeader,
} from './components.jsx'

const axis = { stroke: '#596578', fontSize: 12, tickLine: false, axisLine: false, tickMargin: 8 }
const tooltip = {
  borderRadius: 2,
  border: '1px solid #b8c2ce',
  boxShadow: '0 2px 6px #182a4012',
  fontSize: 13,
}
const analyses = {
  daily: 'Daily error',
  distribution: 'Error distribution',
  hour: 'Delivery hour',
  horizon: 'Forecast horizon',
}

function Diagnostics({ data, horizon, analysis }) {
  const [showTable, setShowTable] = useState(false)
  const numericTooltip = (value) => `${mw(value)} MW`
  const chartProps = { margin: { top: 12, right: 24, left: 0, bottom: 6 } }
  const grid = <CartesianGrid vertical={false} stroke="var(--grid)" />
  let chart, tableRows, columns
  if (analysis === 'distribution') {
    tableRows = data.histogram.map((r) => ({ ...r, label: `${r.from / 1000} to ${r.to / 1000}` }))
    columns = [
      ['Error band (GW)', 'label'],
      ['Half-hours', 'count'],
    ]
    chart = (
      <BarChart {...chartProps} data={tableRows}>
        {grid}
        <XAxis {...axis} dataKey="label" minTickGap={20} />
        <YAxis {...axis} width={64} allowDecimals={false} />
        <Tooltip contentStyle={tooltip} labelFormatter={(value) => `${value} GW error`} />
        <Bar dataKey="count" name="Half-hours" fill="var(--forecast)" isAnimationActive={false} />
      </BarChart>
    )
  } else if (analysis === 'hour') {
    tableRows = data.by_hour
    columns = [
      ['Delivery hour UTC', 'hour'],
      ['MAE MW', 'mae'],
      ['Bias MW', 'bias'],
      ['Pairs', 'n'],
    ]
    chart = (
      <LineChart {...chartProps} data={tableRows}>
        {grid}
        <XAxis
          {...axis}
          dataKey="hour"
          tickFormatter={(h) => `${String(h).padStart(2, '0')}:00`}
          minTickGap={20}
        />
        <YAxis {...axis} width={64} tickFormatter={mw} />
        <ReferenceLine y={0} stroke="#9ca6b3" />
        <Tooltip
          contentStyle={tooltip}
          formatter={numericTooltip}
          labelFormatter={(h) => `${String(h).padStart(2, '0')}:00 UTC`}
        />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 14 }} />
        <Line
          dataKey="mae"
          name="MAE"
          stroke="var(--forecast)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <Line
          dataKey="bias"
          name="Bias"
          stroke="var(--risk)"
          strokeDasharray="5 4"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    )
  } else if (analysis === 'horizon') {
    if (horizon.loading || horizon.error)
      return <ApiState request={horizon} label="Loading horizon analysis" />
    tableRows = (horizon.data?.buckets || []).map((r) => ({
      ...r,
      label: `${r.from_h}–${r.to_h} h`,
    }))
    columns = [
      ['Lead time', 'label'],
      ['MAE MW', 'mae'],
      ['RMSE MW', 'rmse'],
      ['Vintage / period pairs', 'n'],
    ]
    chart = (
      <BarChart {...chartProps} data={tableRows}>
        {grid}
        <XAxis {...axis} dataKey="label" />
        <YAxis {...axis} width={64} tickFormatter={mw} />
        <Tooltip
          contentStyle={tooltip}
          formatter={(v, name) => (name === 'MAE' ? `${mw(v)} MW` : mw(v))}
        />
        <Bar dataKey="mae" name="MAE" fill="var(--forecast)" isAnimationActive={false} />
      </BarChart>
    )
  } else {
    tableRows = data.daily
    chart = (
      <ComposedChart {...chartProps} data={tableRows}>
        {grid}
        <XAxis {...axis} dataKey="date" tickFormatter={shortDate} minTickGap={28} />
        <YAxis {...axis} width={64} tickFormatter={mw} />
        <ReferenceLine y={0} stroke="#9ca6b3" />
        <Tooltip
          contentStyle={tooltip}
          formatter={numericTooltip}
          labelFormatter={(day) => `${shortDate(day)} 2026`}
        />
        <Legend iconType="plainline" wrapperStyle={{ fontSize: 12, paddingTop: 14 }} />
        <Bar
          dataKey="mae"
          name="MAE"
          fill="var(--forecast)"
          maxBarSize={28}
          isAnimationActive={false}
        />
        <Line
          dataKey="bias"
          name="Bias"
          stroke="var(--risk)"
          strokeWidth={2}
          dot={false}
          strokeDasharray="5 4"
          isAnimationActive={false}
        />
      </ComposedChart>
    )
  }
  const titles = {
    daily: 'Daily forecast error',
    distribution: 'Error distribution',
    hour: 'Error by delivery hour',
    horizon: 'Error by forecast horizon',
  }
  const descriptions = {
    daily: 'Mean absolute error and signed bias · MW. Full values and day drill-down below.',
    distribution:
      'Forecast minus actual · positive values mean wind fell short. Bands in GW; counts in half-hours.',
    hour: 'Errors grouped by delivery hour · UTC · MW.',
    horizon:
      'All vintages, grouped by publication-to-delivery lead · MW. Samples overlap and counts differ.',
  }
  return (
    <>
      <div className="diagnostic-heading">
        <h3>{titles[analysis]}</h3>
        <p>{descriptions[analysis]}</p>
      </div>
      <div
        className="diagnostic-chart"
        role="group"
        aria-label={`${titles[analysis]}. ${descriptions[analysis]}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {chart}
        </ResponsiveContainer>
      </div>
      {columns && (
        <div className="analysis-data">
          <button
            className="text-button"
            aria-expanded={showTable}
            onClick={() => setShowTable((v) => !v)}
          >
            {showTable ? 'Hide analysis data' : 'Show analysis data table'}
          </button>
          {showTable && (
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label={`${titles[analysis]} data`}
            >
              <table>
                <caption className="sr-only">
                  {titles[analysis]} — {descriptions[analysis]}
                </caption>
                <thead>
                  <tr>
                    {columns.map(([label, key]) => (
                      <th scope="col" key={key}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {tableRows.map((row, i) => (
                    <tr key={i}>
                      {columns.map(([, key], j) =>
                        j === 0 ? (
                          <th scope="row" key={key}>
                            {row[key]}
                          </th>
                        ) : (
                          <td key={key}>{mw(row[key])}</td>
                        )
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  )
}

export default function AccuracyView({ meta, cutoff, setCutoff, range, setRange, onInspectDay }) {
  const start =
    range.start >= meta.delivery_start && range.start <= meta.delivery_end
      ? range.start
      : meta.delivery_start
  const end = range.end >= start && range.end <= meta.delivery_end ? range.end : meta.delivery_end
  const [analysis, setAnalysis] = useState('daily')
  const [sort, setSort] = useState({ field: 'date', direction: 1 })
  const [focusWorst, setFocusWorst] = useState(false)
  const query = `start=${start}&end=${end}`
  const request = useApi(`/api/accuracy?cutoff=${cutoff}&${query}`)
  const horizon = useApi(`/api/horizon?${query}`)
  const data = request.data
  const o = data?.overall
  const daily = data
    ? sortedRows(data.daily, focusWorst ? { field: 'mae', direction: -1 } : sort)
    : []

  function exportDaily() {
    if (!data) return
    downloadCsv(
      `windwatch-accuracy-${start}-${end}-${cutoff.replace(':', '')}.csv`,
      [
        'source',
        'delivery_date_utc',
        'decision_cutoff_utc',
        'matched_half_hours',
        'mae_mw',
        'rmse_mw',
        'bias_mw',
        'wape_pct',
        'p90_absolute_error_mw',
        'max_absolute_error_mw',
      ],
      data.daily.map((row) => [
        meta.source,
        row.date,
        cutoff,
        row.n,
        row.mae,
        row.rmse,
        row.bias,
        row.wape_pct,
        row.p90_abs,
        row.max_abs,
      ])
    )
  }

  return (
    <section aria-label="Forecast accuracy">
      <div className="filter-toolbar range-toolbar">
        <div className="field">
          <label htmlFor="accuracy-start">First delivery day</label>
          <input
            id="accuracy-start"
            type="date"
            min={meta.delivery_start}
            max={end}
            value={start}
            onChange={(e) =>
              e.target.value >= meta.delivery_start &&
              e.target.value <= end &&
              setRange({ start: e.target.value, end })
            }
          />
        </div>
        <div className="field">
          <label htmlFor="accuracy-end">Last delivery day</label>
          <input
            id="accuracy-end"
            type="date"
            min={start}
            max={meta.delivery_end}
            value={end}
            onChange={(e) =>
              e.target.value >= start &&
              e.target.value <= meta.delivery_end &&
              setRange({ start, end: e.target.value })
            }
          />
        </div>
        <CutoffControl value={cutoff} onChange={setCutoff} />
        <button
          className="text-button reset-range"
          onClick={() => setRange({ start: meta.delivery_start, end: meta.delivery_end })}
        >
          Full period
        </button>
        <button className="button toolbar-action" disabled={!data} onClick={exportDaily}>
          <Icon name="download" />
          Export daily CSV
        </button>
      </div>
      <ApiState request={request} label="Calculating forecast accuracy" />
      {data && (
        <>
          <div className="coverage-line">
            <strong>
              {mw(o.n)} / {mw(data.coverage.expected_intervals)} paired half-hours
            </strong>
            <span>{pct(data.coverage.matched_pct)} coverage</span>
            <span>
              Purchase decisions {shortDate(previousDay(start))}–{shortDate(previousDay(end))} 2026
              at {cutoff} UTC
            </span>
          </div>
          {data.coverage.matched_pct < 100 && (
            <div className="notice warning" role="status">
              <strong>Metrics use matched intervals only.</strong>
              <p>
                {data.coverage.missing_forecast_intervals} missing forecasts;{' '}
                {data.coverage.missing_actual_intervals} missing actuals. Gaps are excluded, never
                replaced with zero.
              </p>
            </div>
          )}
          {!o.n ? (
            <div className="empty-state">
              <h2>No matched data at this cutoff</h2>
              <p>Choose another cutoff or delivery range.</p>
            </div>
          ) : (
            <>
              <dl className="metric-strip accuracy-metrics">
                <Metric
                  label="Mean absolute error"
                  value={mw(o.mae)}
                  unit="MW"
                  detail="Average absolute forecast error"
                />
                <Metric
                  label="Root mean square error"
                  value={mw(o.rmse)}
                  unit="MW"
                  detail="More weight on large errors"
                />
                <Metric
                  label="Forecast bias"
                  value={`${o.bias > 0 ? '+' : ''}${mw(o.bias)}`}
                  unit="MW"
                  detail="Positive means wind over-forecast"
                />
                <Metric
                  label="Weighted absolute error"
                  value={pct(o.wape_pct)}
                  detail="Total absolute error / total actual"
                />
              </dl>
              <section className="panel diagnostics" aria-label="Error analysis">
                <div className="panel-heading">
                  <h2>Error analysis</h2>
                  <label className="analysis-picker">
                    Breakdown
                    <select
                      aria-label="Error analysis breakdown"
                      value={analysis}
                      onChange={(e) => setAnalysis(e.target.value)}
                    >
                      {Object.entries(analyses).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <Diagnostics key={analysis} data={data} horizon={horizon} analysis={analysis} />
              </section>
              <div className="secondary-stat-line">
                <span>
                  P90 absolute error <strong>{mw(o.p90_abs)} MW</strong>
                </span>
                <span>
                  Largest absolute error <strong>{mw(o.max_abs)} MW</strong>
                </span>
                <span>Positive error = forecast above actual wind.</span>
              </div>
              <section className="panel daily-panel" aria-labelledby="daily-heading">
                <div className="panel-heading">
                  <div>
                    <h2 id="daily-heading">Daily accuracy</h2>
                    <p>Select a delivery date to inspect its available forecast.</p>
                  </div>
                  <label className="checkbox-control">
                    <input
                      type="checkbox"
                      checked={focusWorst}
                      onChange={(e) => setFocusWorst(e.target.checked)}
                    />
                    Largest errors first
                  </label>
                </div>
                <div
                  className="table-scroll daily-table"
                  tabIndex={0}
                  role="region"
                  aria-label="Daily accuracy results"
                >
                  <table>
                    <caption className="sr-only">
                      Daily accuracy at cutoff {cutoff} UTC. Error values in MW except WAPE. Counts
                      show paired half-hours.
                    </caption>
                    <thead>
                      <tr>
                        {[
                          ['Delivery date', 'date'],
                          ['Pairs / 48', 'n'],
                          ['MAE MW', 'mae'],
                          ['RMSE MW', 'rmse'],
                          ['Bias MW', 'bias'],
                          ['WAPE', 'wape_pct'],
                          ['Max error MW', 'max_abs'],
                        ].map(([label, field], i) => (
                          <SortHeader
                            key={field}
                            first={!i}
                            label={label}
                            field={field}
                            sort={focusWorst ? { field: 'mae', direction: -1 } : sort}
                            onSort={(field) => {
                              setFocusWorst(false)
                              setSort((s) => nextSort(s, field))
                            }}
                          />
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((row) => (
                        <tr key={row.date}>
                          <th scope="row">
                            <button
                              className="cell-link"
                              aria-label={`Inspect forecast for ${row.date}`}
                              onClick={() => onInspectDay(row.date)}
                            >
                              {row.date}
                            </button>
                          </th>
                          <td>{row.n}</td>
                          <td>{mw(row.mae)}</td>
                          <td>{mw(row.rmse)}</td>
                          <td>
                            {row.bias > 0 ? '+' : ''}
                            {mw(row.bias)}
                          </td>
                          <td>{pct(row.wape_pct)}</td>
                          <td>{mw(row.max_abs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="table-footer">
                  {daily.length} delivery days · observed outcomes, unavailable at purchase time
                </div>
              </section>
              <details className="method-disclosure">
                <summary>Error percentiles & calculation notes</summary>
                <div className="method-copy">
                  <p>
                    Full-period statistics describe realized outcomes; the forecast workspace
                    calculates its allowance from earlier published data only.
                  </p>
                  <dl className="quantile-list">
                    {Object.entries(data.risk_buffer).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.toUpperCase()} actual minus forecast</dt>
                        <dd>{mw(value)} MW</dd>
                      </div>
                    ))}
                  </dl>
                  <p>
                    Percentiles use linear interpolation. WAPE is undefined when total actual
                    generation is zero. Vintage observations in the horizon chart are correlated and
                    are not independent trials.
                  </p>
                </div>
              </details>
            </>
          )}
        </>
      )}
    </section>
  )
}
