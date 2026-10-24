import { useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from 'recharts'
import { ApiState, fmtPub, fmtTime, mw, pct, previousDay, shortDate, useApi } from './useApi.jsx'
import {
  CutoffControl,
  Icon,
  Metric,
  nextSort,
  sortedRows,
  SortHeader,
  ViewSwitch,
} from './components.jsx'

function intervalLabel(row) {
  const start = Date.parse(row.t)
  const end = new Date(start + 1800000).toISOString().slice(11, 16)
  return `${fmtTime(row.t)}–${end}`
}

function ProfileTooltip({ active, payload, unit, showActual }) {
  if (!active || !payload?.length) return null
  const row = payload[0].payload
  const format = (value) =>
    value == null ? '—' : unit === 'GW' ? (value / 1000).toFixed(2) : mw(value)
  return (
    <div className="chart-tooltip">
      <strong>{intervalLabel(row)} UTC</strong>
      <dl>
        <div>
          <dt>Forecast</dt>
          <dd>
            {format(row.forecast)} {unit}
          </dd>
        </div>
        <div>
          <dt>Lower estimate</dt>
          <dd>
            {format(row.lower_estimate)} {unit}
          </dd>
        </div>
        {showActual && (
          <div>
            <dt>Actual</dt>
            <dd>
              {format(row.actual)} {unit}
            </dd>
          </div>
        )}
      </dl>
      <p>Published {fmtPub(row.publishTime)}</p>
    </div>
  )
}

export default function DecisionView({ meta, cutoff, setCutoff, day, setDay }) {
  const [showActual, setShowActual] = useState(false)
  const [view, setView] = useState('chart')
  const [unit, setUnit] = useState('GW')
  const [period, setPeriod] = useState(0)
  const [missingOnly, setMissingOnly] = useState(false)
  const [sort, setSort] = useState({ field: 'period', direction: 1 })
  const request = useApi(`/api/day?date=${day}&cutoff=${cutoff}`)
  const data = request.data
  const dayIndex = meta.days.indexOf(day)
  const series =
    data?.series.map((row, i) => ({ ...row, period: i + 1, time: fmtTime(row.t) })) || []
  const selected = series[period]
  const complete = data?.coverage.forecast_intervals === 48
  const rows = sortedRows(
    series.filter((row) => !missingOnly || row.forecast == null),
    sort
  )
  const scale = unit === 'GW' ? 1000 : 1
  const chartData = series.map((row) => ({
    ...row,
    plottedForecast: row.forecast == null ? null : row.forecast / scale,
    plottedLower: row.lower_estimate == null ? null : row.lower_estimate / scale,
    plottedActual: row.actual == null ? null : row.actual / scale,
  }))

  return (
    <section aria-label="Decision workspace">
      <div className="filter-toolbar">
        <div className="field decision-field">
          <label htmlFor="decision-day">Purchase decision date</label>
          <div className="date-stepper">
            <button
              className="icon-button"
              aria-label="Previous decision day"
              disabled={dayIndex <= 0}
              onClick={() => setDay(meta.days[dayIndex - 1])}
            >
              <Icon name="left" />
            </button>
            <select id="decision-day" value={day} onChange={(e) => setDay(e.target.value)}>
              {meta.days.map((d) => (
                <option value={d} key={d}>
                  {shortDate(previousDay(d))} 2026
                </option>
              ))}
            </select>
            <button
              className="icon-button"
              aria-label="Next decision day"
              disabled={dayIndex >= meta.days.length - 1}
              onClick={() => setDay(meta.days[dayIndex + 1])}
            >
              <Icon name="right" />
            </button>
          </div>
        </div>
        <CutoffControl value={cutoff} onChange={setCutoff} />
        <div className="field delivery-field">
          <span className="field-label">Delivery date</span>
          <strong>{shortDate(day)} 2026</strong>
        </div>
        <a
          className="button toolbar-action"
          href={`/api/export/day.csv?date=${day}&cutoff=${cutoff}`}
          title="Download all 48 intervals, including hindsight actuals"
        >
          <Icon name="download" />
          Export day CSV
        </a>
      </div>
      <ApiState request={request} label="Loading decision snapshot" />
      {data && (
        <>
          {!complete && (
            <div className="notice warning" role="status">
              <strong>Incomplete forecast coverage</strong>
              <p>
                {data.coverage.forecast_intervals} of 48 half-hours have a forecast at this cutoff.
                Missing periods are excluded from the average. Full-day energy is unavailable.
              </p>
            </div>
          )}
          <dl className="metric-strip forecast-metrics">
            <Metric
              label="Average forecast wind"
              value={mw(data.summary.forecast_mean)}
              unit="MW"
              detail={complete ? '24-hour delivery average' : 'Available periods only'}
            />
            <Metric
              label="Forecast range"
              value={`${mw(data.summary.forecast_min)}–${mw(data.summary.forecast_max)}`}
              unit="MW"
              detail="Minimum to maximum"
            />
            <Metric
              label="Forecast energy"
              value={mw(data.summary.forecast_energy_mwh)}
              unit="MWh"
              detail="Full delivery day"
            />
            <Metric
              label="Shortfall allowance"
              value={mw(data.summary.buffer_mw)}
              unit="MW"
              detail={
                data.calibration.sufficient
                  ? `P90 · ${data.calibration.n} earlier periods`
                  : 'Insufficient earlier history'
              }
            />
            <Metric
              label="Forecast coverage"
              value={`${data.coverage.forecast_intervals} / 48`}
              detail={
                complete
                  ? 'All settlement periods available'
                  : `${48 - data.coverage.forecast_intervals} missing periods`
              }
              className={!complete ? 'incomplete' : ''}
            />
          </dl>
          <div className="forecast-layout">
            <section className="panel profile-panel" aria-labelledby="profile-heading">
              <div className="panel-heading">
                <div>
                  <h2 id="profile-heading">
                    Wind generation <span>{shortDate(day)} 2026</span>
                  </h2>
                  <p>Delivery time, UTC · 30-minute settlement periods</p>
                </div>
                <ViewSwitch value={view} onChange={setView} label="Forecast display" />
              </div>
              <div className="plot-toolbar">
                <div className="series-key" role="group" aria-label="Chart series">
                  <span>
                    <i className="line-key forecast-key" />
                    Forecast at cutoff
                  </span>
                  <span>
                    <i className="line-key lower-key" />
                    Historical lower estimate
                  </span>
                  {showActual && (
                    <span>
                      <i className="line-key actual-key" />
                      Actual
                    </span>
                  )}
                </div>
                <div className="plot-options">
                  <label className="checkbox-control">
                    <input
                      type="checkbox"
                      checked={showActual}
                      onChange={(e) => setShowActual(e.target.checked)}
                    />
                    Show hindsight actuals
                  </label>
                  {view === 'chart' && (
                    <label className="unit-control">
                      Unit
                      <select
                        aria-label="Chart unit"
                        value={unit}
                        onChange={(e) => setUnit(e.target.value)}
                      >
                        <option>GW</option>
                        <option>MW</option>
                      </select>
                    </label>
                  )}
                </div>
              </div>
              {view === 'chart' ? (
                <>
                  <div
                    className="profile-chart"
                    role="group"
                    aria-label={`Wind forecast for ${day}. Values in ${unit}. Select Table for all interval values.`}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart
                        data={chartData}
                        margin={{ left: 0, right: 22, top: 16, bottom: 6 }}
                        onClick={(state) => {
                          const index = series.findIndex((row) => row.time === state?.activeLabel)
                          if (index >= 0) setPeriod(index)
                        }}
                      >
                        <CartesianGrid vertical={false} stroke="var(--grid)" />
                        <XAxis
                          dataKey="time"
                          ticks={['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '23:30']}
                          minTickGap={18}
                          stroke="var(--muted)"
                          fontSize={12}
                          tickLine={false}
                          axisLine={{ stroke: 'var(--border)' }}
                          tickMargin={10}
                        />
                        <YAxis
                          stroke="var(--muted)"
                          fontSize={12}
                          tickLine={false}
                          axisLine={false}
                          width={64}
                          domain={[0, 'auto']}
                          tickFormatter={(v) => (unit === 'GW' ? v.toFixed(1) : mw(v))}
                        />
                        <Tooltip
                          content={<ProfileTooltip unit={unit} showActual={showActual} />}
                          cursor={{ stroke: '#9aa7b5', strokeDasharray: '3 3' }}
                        />
                        <ReferenceLine x={selected?.time} stroke="#9ba7b4" strokeDasharray="3 3" />
                        <Line
                          dataKey="plottedForecast"
                          name="Forecast at cutoff"
                          stroke="var(--forecast)"
                          strokeWidth={2.2}
                          dot={false}
                          activeDot={{ r: 4 }}
                          type="stepAfter"
                          isAnimationActive={false}
                        />
                        <Line
                          dataKey="plottedLower"
                          name="Historical lower estimate"
                          stroke="var(--risk)"
                          strokeWidth={1.8}
                          strokeDasharray="6 4"
                          dot={false}
                          type="stepAfter"
                          isAnimationActive={false}
                        />
                        {showActual && (
                          <Line
                            dataKey="plottedActual"
                            name="Actual · hindsight"
                            stroke="var(--actual)"
                            strokeWidth={1.8}
                            dot={false}
                            isAnimationActive={false}
                          />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="plot-footnote">
                    <span>Select a period on the chart to inspect its publication.</span>
                    <span>Forecasts held flat over each hour.</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="table-toolbar">
                    <span>{rows.length} of 48 periods · values in MW</span>
                    <label className="checkbox-control">
                      <input
                        type="checkbox"
                        checked={missingOnly}
                        onChange={(e) => setMissingOnly(e.target.checked)}
                      />
                      Only missing forecasts
                    </label>
                  </div>
                  <div
                    className="table-scroll interval-table"
                    tabIndex={0}
                    role="region"
                    aria-label="Settlement interval data"
                  >
                    <table>
                      <caption className="sr-only">
                        Forecast provenance for {day}. Select a period to inspect it. All generation
                        values in MW.
                      </caption>
                      <thead>
                        <tr>
                          <SortHeader
                            first
                            label="Period"
                            field="period"
                            sort={sort}
                            onSort={(field) => setSort((s) => nextSort(s, field))}
                          />
                          <SortHeader
                            label="Forecast MW"
                            field="forecast"
                            sort={sort}
                            onSort={(field) => setSort((s) => nextSort(s, field))}
                          />
                          <th scope="col">Lower estimate MW</th>
                          <th scope="col">Published UTC</th>
                          {showActual && (
                            <>
                              <th scope="col">Actual MW</th>
                              <th scope="col">Error MW</th>
                            </>
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.t}
                            className={period === row.period - 1 ? 'selected-row' : ''}
                          >
                            <th scope="row">
                              <button
                                className="cell-link"
                                aria-label={`Inspect period ${row.period}, ${intervalLabel(row)} UTC`}
                                onClick={() => setPeriod(row.period - 1)}
                              >
                                <span className="period-number">
                                  {String(row.period).padStart(2, '0')}
                                </span>
                                {intervalLabel(row)}
                              </button>
                            </th>
                            <td>{mw(row.forecast)}</td>
                            <td>{mw(row.lower_estimate)}</td>
                            <td>{fmtPub(row.publishTime)}</td>
                            {showActual && (
                              <>
                                <td>{mw(row.actual)}</td>
                                <td>{mw(row.error)}</td>
                              </>
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!rows.length && (
                      <div className="table-empty">No missing forecasts at this cutoff.</div>
                    )}
                  </div>
                </>
              )}
              {showActual && (
                <div className="hindsight-strip">
                  <strong>Hindsight review</strong>
                  <span>
                    MAE <b>{mw(data.day_metrics.mae)} MW</b>
                  </span>
                  <span>
                    RMSE <b>{mw(data.day_metrics.rmse)} MW</b>
                  </span>
                  <span>
                    Bias <b>{mw(data.day_metrics.bias)} MW</b>
                  </span>
                  <span>
                    WAPE <b>{pct(data.day_metrics.wape_pct)}</b>
                  </span>
                </div>
              )}
            </section>
            <aside className="panel interval-inspector" aria-labelledby="inspector-heading">
              <div className="inspector-heading">
                <h2 id="inspector-heading">Interval detail</h2>
                <span>UTC</span>
              </div>
              <label className="field-label" htmlFor="period-select">
                Settlement period
              </label>
              <div className="period-stepper">
                <button
                  className="icon-button"
                  disabled={period === 0}
                  aria-label="Previous settlement period"
                  onClick={() => setPeriod((p) => p - 1)}
                >
                  <Icon name="left" />
                </button>
                <select
                  id="period-select"
                  value={period}
                  onChange={(e) => setPeriod(Number(e.target.value))}
                >
                  {series.map((row, index) => (
                    <option key={row.t} value={index}>
                      {String(index + 1).padStart(2, '0')} · {intervalLabel(row)}
                    </option>
                  ))}
                </select>
                <button
                  className="icon-button"
                  disabled={period === 47}
                  aria-label="Next settlement period"
                  onClick={() => setPeriod((p) => p + 1)}
                >
                  <Icon name="right" />
                </button>
              </div>
              <dl className="interval-values" aria-live="polite">
                <div>
                  <dt>Forecast at cutoff</dt>
                  <dd className="forecast-value">
                    {mw(selected?.forecast)} <span>MW</span>
                  </dd>
                </div>
                <div>
                  <dt>Historical lower estimate</dt>
                  <dd>
                    {mw(selected?.lower_estimate)} <span>MW</span>
                  </dd>
                </div>
                {showActual && (
                  <div>
                    <dt>
                      Actual <span className="muted">· hindsight</span>
                    </dt>
                    <dd>
                      {mw(selected?.actual)} <span>MW</span>
                    </dd>
                  </div>
                )}
              </dl>
              <dl className="publication-detail">
                <div>
                  <dt>Forecast published</dt>
                  <dd>{fmtPub(selected?.publishTime)}</dd>
                </div>
                <div>
                  <dt>Lead to delivery</dt>
                  <dd>
                    {selected?.lead_hours == null ? 'Unavailable' : `${selected.lead_hours} hours`}
                  </dd>
                </div>
                <div>
                  <dt>Purchase cutoff</dt>
                  <dd>{fmtPub(data.decision_time)}</dd>
                </div>
              </dl>
            </aside>
          </div>
          <div className="calibration-bar">
            <strong>Allowance basis</strong>
            <span>
              {data.calibration.sufficient
                ? `${data.calibration.days} completed delivery days · ${data.calibration.n} matched half-hours · ${shortDate(data.calibration.start)}–${shortDate(data.calibration.end)}`
                : 'Insufficient history: at least 48 earlier, published pairs are required.'}
            </span>
            <span className="muted">Historical estimate; no confidence guarantee.</span>
          </div>
          <details className="method-disclosure">
            <summary>Decision rules & limitations</summary>
            <div className="method-copy">
              <p>
                For each target hour, use the latest WINDFOR publication at or before {cutoff} UTC
                on the previous day. The {meta.default_cutoff} default is a scenario assumption.
              </p>
              <p>
                The lower estimate subtracts the earlier P90 wind shortfall, floored at zero.
                Calibration excludes future outcomes, incomplete delivery days, and actual revisions
                published after this decision.
              </p>
              <p>
                National wind alone does not determine additional procurement. Customer demand,
                contracted generation and prices are outside this dataset. CSV exports include
                explicitly labelled hindsight actuals.
              </p>
            </div>
          </details>
        </>
      )}
    </section>
  )
}
