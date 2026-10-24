# WindWatch

WindWatch is a web application for reviewing Great Britain's national wind-generation forecasts in the context of day-ahead electricity purchasing. It helps energy procurement teams and analysts answer two questions: **what wind forecast was available when a purchase decision was made, and how did that forecast compare with actual generation?**

The application combines an interactive React dashboard with a Python API and a bundled historical Elexon BMRS dataset. Users can reconstruct a decision, inspect the next-day wind profile, explore forecast errors and export the supporting data.

**Current scope:** purchase decisions from January 1 to January 31, 2026, for delivery from January 2 to February 1, 2026. All timestamps are UTC. The application uses a historical snapshot; refreshing that snapshot does not extend the configured analysis period.

## Customer perspective

### The problem

Wind generation can differ from its forecast. For an electricity buyer, overestimating the wind available can leave more demand to cover from other sources. Reviewing that risk requires the forecast that was available at the time of the decision: a later forecast revision can make a historical decision appear better informed than it actually was.

WindWatch makes that distinction visible. It selects forecasts by publication time, shows gaps in the available data and keeps actual generation as an explicit hindsight comparison in the Forecast workspace.

### Who it helps

| User | How WindWatch helps |
| --- | --- |
| Energy buyers and procurement teams | Inspect the next-day national wind profile at a chosen purchase cutoff and review a historical allowance for lower wind output when enough prior data is available. |
| Energy analysts and risk teams | Measure forecast error, identify difficult days and delivery hours, and compare error across publication-to-delivery horizons. |
| Reviewers and stakeholders | Trace results to forecast publications, inspect coverage and methodology, and export data for further analysis. |

### What users can do

| Workspace | Capabilities | Purpose |
| --- | --- | --- |
| **Forecast** | Choose a purchase date and cutoff; inspect the next-day profile in chart or table form; review publication timestamps, interval details and a historical lower estimate; optionally reveal actuals; export a day CSV. | Reconstruct the information available for a purchase decision and examine possible wind shortfalls. |
| **Accuracy** | Filter delivery dates, compare error measures, explore daily trends, error distributions, delivery-hour patterns and forecast horizons, sort daily results, export daily CSV or open a day's original forecast. | Understand where forecasts performed well and where they missed. |
| **Data & methodology** | Inspect data sources, coverage, snapshot retrieval time and calculation rules. | Understand the evidence and assumptions behind the results. |

For example, a user reviewing a purchase decision on **January 15 at 09:00 UTC** selects that purchase date and cutoff. WindWatch displays the **January 16** delivery profile using only forecast publications available by that decision time. The user can inspect the historical lower estimate where sufficient earlier data exists, then enable actuals or open Accuracy to review the outcome.

The URL preserves selected dates, cutoff and workspace so a view can be reopened or shared. See the [UI/UX research and design decisions](docs/UI_UX_REVIEW.md).

### What the results mean

WindWatch supports analysis of national wind availability. A utility's procurement requirement also depends on demand, contracted generation and its own portfolio; those inputs are outside the current project. The historical allowance describes a limited sample of earlier forecast errors and does not provide a confidence guarantee.

## Technical perspective

### Architecture and stack

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| Frontend | React, Vite and Recharts | Interactive workspaces, charts, tables, URL state and CSV download controls. |
| API | Python 3.12, FastAPI and Uvicorn | Validate request parameters and expose forecast profiles, accuracy, coverage, metadata and exports. |
| Analysis | Pure Python functions in `backend/app/analysis.py` | Select forecasts available at the cutoff, align intervals and calculate metrics, historical allowances and horizon diagnostics. |
| Data loading | Validated JSON snapshot with an in-memory dataset cache | Load actuals and forecast publication histories, normalize timestamps and enforce data integrity. |
| Ingestion | Python and Requests | Fetch Elexon FUELHH and WINDFOR records, validate coverage and atomically replace the snapshot. |
| Delivery | Docker Compose or Vercel configuration | Serve the frontend and API through a combined container or a static frontend with a Python API function. |

Data flows from **Elexon BMRS → ingestion and validation → JSON snapshot → analysis and API → React dashboard**. A database is not required. Normal application startup and analysis use the bundled snapshot without an API key or a live Elexon connection; ingestion is a separate command.

### API overview

All endpoints below use `GET`. Dates use `YYYY-MM-DD`; cutoffs use `HH:MM` in UTC.

| Endpoint | Parameters | Returns |
| --- | --- | --- |
| `/api/health` | None | Dataset readiness, source and synthetic-data status. |
| `/api/meta` | None | Available delivery days, configured scope, default cutoff, record counts, coverage and data quality. |
| `/api/day` | Required `date` (delivery date); optional `cutoff` | Half-hourly forecast profile, publication times, actuals, historical lower estimates, coverage and day metrics. |
| `/api/accuracy` | Optional `start`, `end` (delivery dates) and `cutoff` | Overall, daily and delivery-hour metrics, error distribution and coverage. |
| `/api/horizon` | Optional `start` and `end` (delivery dates) | Error metrics grouped by publication-to-delivery lead time across forecast publications. |
| `/api/export/day.csv` | Required `date` (delivery date); optional `cutoff` | Downloadable interval data with actual/error columns explicitly labeled as hindsight. |

`cutoff` defaults to `09:00`; omitted range bounds use the configured delivery period. The day API receives a **delivery date**, while the Forecast workspace presents the corresponding **purchase date**. For the example above, the request is `/api/day?date=2026-01-16&cutoff=09:00`.

Interactive API documentation is available at **http://localhost:8000/docs** when running locally. The API returns actuals for retrospective analysis; the Forecast UI makes their display opt-in.

## Run locally

Requires Python 3.12 and Node.js 22.12 or newer.

```sh
python -m venv .venv
# Activate: source .venv/bin/activate
# Windows PowerShell: .\.venv\Scripts\Activate.ps1
python -m pip install -r requirements-dev.txt
python -m uvicorn backend.app.main:app --reload --port 8000
```

In another terminal:

```sh
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. Vite proxies API requests to port 8000. API documentation: **http://localhost:8000/docs**.

To serve the built UI from FastAPI, run `npm run build` in `frontend`, then start Uvicorn from the repository root and open **http://localhost:8000**.

## Dataset

The bundled real dataset is **[`backend/data/elexon_wind_jan2026.json`](backend/data/elexon_wind_jan2026.json)**, approximately **1.85 MB**. Keep this file in the repository; the application and tests use it. No API key or startup download is needed.

| Data | Records |
| --- | --- |
| FUELHH actual wind generation, half-hourly | 1,488 |
| WINDFOR forecast target/publication pairs | 18,080 |
| Hourly delivery targets | 744 |

Coverage is 100% at the default 09:00 cutoff. Earlier cutoffs can have genuine gaps, which remain missing rather than being filled with later forecasts.

Refresh the real snapshot:

```sh
python -m backend.app.ingest
```

The importer retries transient errors, validates timestamps and values, resolves duplicates/revisions, and replaces the previous snapshot atomically only after coverage checks pass. Restart the backend after refreshing the file.

An optional synthetic fixture can be generated with `python backend/scripts/make_sample_data.py`. The resulting `sample_wind_jan2026.json` is ignored by Git. The backend prefers the real snapshot, otherwise uses a generated sample if present and displays a warning. `WINDWATCH_DATA_FILE` selects an explicit dataset.

More detail: [dataset documentation](backend/data/README.md). Sources: [Elexon FUELHH](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) and [Elexon WINDFOR](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream).

## Dependencies

Only two Python requirements files are maintained:

| File | Purpose |
| --- | --- |
| `requirements.txt` | Runtime: FastAPI, Uvicorn and Requests |
| `requirements-dev.txt` | Includes runtime requirements, plus pytest, the HTTP test client and Ruff |

Direct dependencies have explicit versions. Pip installs their transitive dependencies normally. The frontend keeps `package-lock.json` for reproducible `npm ci` installs.

## Analysis rules

For delivery day D, select the latest forecast publication at or before the configurable D-1 purchase cutoff. The 09:00 default is a scenario assumption, not a universal market gate closure. Each hourly forecast applies to both half-hours.

Power values are in MW, with a GW display option in the Forecast workspace; daily forecast energy is in MWh. Each half-hour contributes `forecast MW × 0.5 hours` to daily energy. Full-day forecast energy is withheld when forecast coverage is incomplete.

Error = forecast minus actual; positive means wind was over-forecast. Metrics and error percentiles use matched forecast/actual intervals only:

| Metric | Interpretation |
| --- | --- |
| MAE (mean absolute error) | Average size of the forecast miss, in MW. |
| RMSE (root mean squared error) | Error measure in MW that gives larger misses more weight. |
| Bias | Average signed error in MW; positive indicates over-forecasting. |
| WAPE (weighted absolute percentage error) | Total absolute error divided by total actual generation, expressed as a percentage; undefined when total actual generation is zero. |

Missing forecasts remain gaps and are never replaced by publications after the selected cutoff.

The historical allowance is `max(0, -P10(actual - forecast))`; the lower estimate is `max(0, forecast - allowance)`. Calibration requires at least 48 pairs from completed earlier delivery days with actuals published by the selected decision. Later revisions and future outcomes are excluded. Limited, correlated history does not provide a confidence guarantee.

Horizon analysis groups each vintage/half-hour pair by publication-to-delivery lead; sample counts differ and vintages overlap. National wind alone cannot determine a utility's additional procurement without demand, contracted generation and portfolio data.

## Project structure

```text
api/                     Vercel entrypoint
backend/app/             Importer, validated store, analysis and FastAPI
backend/data/            Real Elexon snapshot and dataset documentation
backend/scripts/         Optional synthetic-data generator
backend/tests/           Analysis, API and data-integrity regressions
frontend/src/            React views, shared controls and styles
frontend/tests/          Desktop/mobile browser tests
frontend/package-lock.json
                         Frontend dependency lock
.github/workflows/       Validation and container checks
docs/                    UI/UX research and design decisions
requirements.txt         Python runtime dependencies
requirements-dev.txt     Python development dependencies
Dockerfile               Combined frontend/backend container
docker-compose.yml       Local container configuration
vercel.json              Vercel build and API routing
```

## Checks

```sh
python -m pytest -q
python -m ruff check backend api
python -m ruff format --check backend api

cd frontend
npm ci
npm run format:check
npm run build
npx playwright install chromium
npm run test:e2e
```

Activate the Python environment before browser tests; they start the built application on port 8765. On Linux CI, use `npx playwright install --with-deps chromium`. `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` can select an existing Chrome executable. `PLAYWRIGHT_EXTERNAL_SERVER=1` uses an application you already started on port 8765.

The backend suite covers forecast selection, metrics, calibration, API behavior, ingestion and dataset integrity. Browser tests run on desktop and mobile configurations and include keyboard, automated accessibility and 320px layout checks. Videos are disabled. Automated accessibility checks do not replace manual screen-reader validation.

## Docker and deployment

```sh
docker compose up --build
```

Open **http://localhost:8000**. The image bundles the real dataset, serves the built UI and API together, runs as an unprivileged user and includes a readiness check. Compose uses a read-only filesystem with temporary storage.

For Vercel, use this repository root, the bundled real dataset and the included `vercel.json`. It builds React with `npm ci` and routes `/api/*` to FastAPI. Python 3.12 is declared in `.python-version`; select Node 22. No ingestion runs during build or function startup.

Docker execution and hosted deployment have not been verified locally; no live deployment URL is claimed. The CI workflow includes a container build and startup check.

## AI disclosure

The initial project used Claude; subsequent implementation and refinement used OpenAI Codex.
