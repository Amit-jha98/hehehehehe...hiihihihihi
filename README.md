# WindWatch

React and Python software for inspecting GB wind forecasts available at a day-ahead purchase cutoff and evaluating their historical error using Elexon BMRS.

**Scope:** purchase decisions January 1?31, 2026; delivery January 2?February 1, 2026. All timestamps are UTC.

**AI disclosure:** the initial project used Claude; subsequent implementation and refinement used OpenAI Codex.

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

The real dataset is **[`backend/data/elexon_wind_jan2026.json`](backend/data/elexon_wind_jan2026.json)**, approximately **1.85 MB**. Commit this file; the application and tests use it. No API key or startup download is needed.

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

## Workspace

- **Forecast:** choose a purchase date and cutoff; inspect the next-day profile, chart/table views, selected publication and historical allowance. Actuals are opt-in hindsight. Day CSV exports label actual/error columns explicitly.
- **Accuracy:** filter delivery dates, compare error measures, select a diagnostic chart, sort daily results, export daily CSV or open a day's original forecast.
- **Data & methodology:** inspect source coverage, snapshot retrieval time and calculation rules.

The URL preserves selected dates, cutoff and view. See the [UI/UX research and design decisions](docs/UI_UX_REVIEW.md).

## Analysis rules

For delivery day D, select the latest forecast publication at or before the configurable D-1 purchase cutoff. The 09:00 default is a scenario assumption, not a universal market gate closure. Each hourly forecast applies to both half-hours.

Error = forecast minus actual; positive means wind was over-forecast. MAE, RMSE, bias, WAPE and error percentiles use matched intervals only. WAPE is undefined when total actual generation is zero. Full-day forecast energy is withheld when coverage is incomplete.

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

The suite contains 43 backend tests and 20 desktop/mobile browser tests, including keyboard, automated accessibility and 320px layout checks. Videos are disabled. Automated accessibility checks do not replace manual screen-reader validation.

## Docker and deployment

```sh
docker compose up --build
```

Open **http://localhost:8000**. The image bundles the real dataset, serves the built UI and API together, runs as an unprivileged user and includes a readiness check. Compose uses a read-only filesystem with temporary storage.

For Vercel, use this repository root, the bundled real dataset and the included `vercel.json`. It builds React with `npm ci` and routes `/api/*` to FastAPI. Python 3.12 is declared in `.python-version`; select Node 22. No ingestion runs during build or function startup.

Docker execution and hosted deployment have not been verified locally; no live deployment URL is claimed. The CI workflow includes a container build and startup check.

## Files to push

Commit source, tests, configuration, documentation, `frontend/package-lock.json` and the real Elexon JSON. `.gitignore` excludes environments, installed dependencies, local tools, caches, builds, browser outputs, logs, secrets, generated sample data and the supplied assignment document. `.env.example` remains included.
