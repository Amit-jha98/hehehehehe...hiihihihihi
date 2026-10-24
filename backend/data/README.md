# Dataset
 `elexon_wind_jan2026.json`

| Content | Count |
| --- | --- |
| Actual wind generation, 30-minute intervals | 1,488 |
| Hourly forecast target/publication pairs | 18,080 |
| Hourly delivery targets | 744 |

Purchase decisions cover January 1–31, 2026; delivery covers January 2–February 1.
The snapshot also records its retrieval time, scope and ingestion quality checks.

Refresh the real snapshot from the repository root:

```sh
python -m backend.app.ingest
```

For optional development data, run:

```sh
python backend/scripts/make_sample_data.py
```

This generates `sample_wind_jan2026.json`. The backend
prefers the real snapshot. To explicitly use the generated sample, set
`WINDWATCH_DATA_FILE=backend/data/sample_wind_jan2026.json`.
