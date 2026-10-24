import { fmtPub, mw, pct } from './useApi.jsx'

export default function DataView({ meta }) {
  const coverage = meta.coverage
  const quality = meta.quality.ingestion || meta.quality
  const facts = [
    ['Source', meta.synthetic ? 'Synthetic development sample' : 'Elexon BMRS public API'],
    ['Snapshot retrieved', fmtPub(meta.generated_at === 'n/a' ? null : meta.generated_at)],
    ['Purchase decisions', `${meta.decision_start} to ${meta.decision_end}`],
    ['Delivery dates', `${meta.delivery_start} to ${meta.delivery_end}`],
    ['Actual intervals', `${mw(coverage.actual_intervals)} / ${mw(coverage.expected_intervals)}`],
    [
      `Forecast intervals at ${meta.default_cutoff} UTC`,
      `${mw(coverage.forecast_intervals)} / ${mw(coverage.expected_intervals)}`,
    ],
    [`Matched coverage at ${meta.default_cutoff} UTC`, pct(coverage.matched_pct)],
    ['Missing generation values', mw(quality.missing_generation_rows)],
    ['Duplicate records removed', mw(quality.duplicate_rows_removed)],
    ['Actual revisions resolved', mw(quality.actual_revisions_resolved)],
  ]
  return (
    <section aria-label="Data and methodology" className="data-page">
      <div className="notice neutral">
        <strong>Historical snapshot</strong>
        <p>
          Decision-time forecasts and realized generation are archived for this exercise. This
          application does not display a live market feed.
        </p>
      </div>
      <div className="data-layout">
        <section className="panel" aria-labelledby="provenance-heading">
          <div className="panel-heading">
            <h2 id="provenance-heading">Coverage & provenance</h2>
          </div>
          <dl className="facts-list">
            {facts.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="panel source-panel" aria-labelledby="source-heading">
          <div className="panel-heading">
            <h2 id="source-heading">Source datasets</h2>
          </div>
          <article>
            <h3>
              FUELHH <span>Actual generation</span>
            </h3>
            <p>{mw(meta.n_actuals)} settlement intervals · 30-minute resolution · fuelType WIND</p>
            <p>National wind output, including the recorded publication timestamp.</p>
            <a
              href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream"
              target="_blank"
              rel="noreferrer"
            >
              Elexon actuals documentation <span className="sr-only">(opens in a new tab)</span>↗
            </a>
          </article>
          <article>
            <h3>
              WINDFOR <span>Wind forecasts</span>
            </h3>
            <p>
              <strong>{mw(meta.n_forecast_rows)}</strong> target/publication pairs · hourly
              resolution
            </p>
            <p>Original and superseded vintages retained for each delivery hour.</p>
            <a
              href="https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream"
              target="_blank"
              rel="noreferrer"
            >
              Elexon forecast documentation <span className="sr-only">(opens in a new tab)</span>↗
            </a>
          </article>
        </section>
      </div>
      <section className="panel methodology" aria-labelledby="method-heading">
        <div className="panel-heading">
          <h2 id="method-heading">Calculation rules</h2>
        </div>
        <div className="method-grid">
          <article>
            <h3>1. Decision and delivery dates</h3>
            <p>
              Purchase decisions January 1–31 correspond to delivery January 2–February 1. All
              timestamps are UTC, also UK local time during this period.
            </p>
          </article>
          <article>
            <h3>2. Available forecast</h3>
            <p>
              For each delivery hour, choose the latest WINDFOR publication at or before the
              previous day’s selected cutoff. The 09:00 default is a scenario assumption, not a
              universal exchange gate closure.
            </p>
          </article>
          <article>
            <h3>3. Settlement alignment</h3>
            <p>
              Each hourly forecast applies to both half-hours. Actuals remain at settlement
              resolution. Missing values remain gaps and are counted separately.
            </p>
          </article>
          <article>
            <h3>4. Error convention</h3>
            <p>
              Error = forecast − actual. Positive error means wind was over-forecast. MAE averages
              absolute error, RMSE weights large misses, and bias averages signed error.
            </p>
          </article>
          <article>
            <h3>5. Historical allowance</h3>
            <p>
              Allowance = max(0, −P10(actual − forecast)). Lower estimate = max(0, forecast −
              allowance). Use at least 48 pairs from completed earlier delivery days, with actuals
              published by the current purchase cutoff. Later revisions are excluded.
            </p>
          </article>
          <article>
            <h3>6. Interpretation limits</h3>
            <p>
              A limited, correlated historical sample does not provide a confidence guarantee.
              National wind does not describe customer demand, contracted generation, prices, or a
              utility’s required procurement.
            </p>
          </article>
        </div>
      </section>
    </section>
  )
}
