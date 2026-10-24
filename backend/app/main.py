from __future__ import annotations

import csv
import io
import logging
from datetime import date
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles

from . import analysis
from .scope import DECISION_END, DECISION_START, TARGET_END, TARGET_START
from .store import Dataset, iso, load

logger = logging.getLogger(__name__)
app = FastAPI(title="WindWatch API", version="2.0.0")


@app.middleware("http")
async def response_headers(request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["X-Frame-Options"] = "DENY"
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


@lru_cache(maxsize=1)
def dataset() -> Dataset:
    try:
        return load()
    except (OSError, ValueError, KeyError, TypeError):
        logger.exception("Could not load the wind dataset")
        raise HTTPException(503, "Wind data is unavailable. Check the dataset or run the importer.") from None


def _cutoff(c: str) -> str:
    try:
        analysis.parse_cutoff(c)
    except (ValueError, TypeError):
        raise HTTPException(422, "cutoff must be HH:MM (UTC)") from None
    return c


def _day(s: str) -> date:
    try:
        d = date.fromisoformat(s)
        if d.isoformat() != s:
            raise ValueError
        return d
    except ValueError:
        raise HTTPException(422, "date must be YYYY-MM-DD") from None


def _delivery(s: str) -> date:
    d = _day(s)
    if not TARGET_START <= d <= TARGET_END:
        raise HTTPException(422, f"delivery date must be {TARGET_START} through {TARGET_END}")
    return d


@app.get("/api/health")
def health():
    ds = dataset()
    if not analysis.available_days(ds):
        raise HTTPException(503, "No data in the decision period")
    return {"ok": True, "source": ds.source, "synthetic": ds.is_synthetic}


@app.get("/api/meta")
def meta():
    ds = dataset()
    return {
        "source": ds.source,
        "synthetic": ds.is_synthetic,
        "generated_at": ds.generated_at,
        "days": [d.isoformat() for d in analysis.available_days(ds)],
        "decision_start": str(DECISION_START),
        "decision_end": str(DECISION_END),
        "delivery_start": str(TARGET_START),
        "delivery_end": str(TARGET_END),
        "default_cutoff": analysis.DEFAULT_CUTOFF,
        "n_actuals": len(ds.actuals),
        "n_forecast_rows": sum(len(v) for v in ds.forecasts.values()),
        "coverage": analysis.coverage(ds, TARGET_START, TARGET_END, analysis.DEFAULT_CUTOFF),
        "quality": ds.quality,
    }


def day_payload(d: date, cutoff: str):
    ds = dataset()
    series = analysis.day_series(ds, d, cutoff)
    if all(r["forecast"] is None and r["actual"] is None for r in series):
        raise HTTPException(404, "No data for that delivery day")
    rows = analysis.pairs(ds, d, d, cutoff)
    pubs = sorted({r["publishTime"] for r in series if r["publishTime"]})
    fc = [r["forecast"] for r in series if r["forecast"] is not None]
    training = analysis.calibration(ds, d, cutoff)
    buffer = max(0, -training["risk_buffer"]["p10"]) if training["sufficient"] else None
    # The lower estimate never exceeds the forecast, even if historical errors are positive.
    for r in series:
        f = r["forecast"]
        r["lower_estimate"] = max(0, f - buffer) if f is not None and buffer is not None else None
    return {
        "date": str(d),
        "cutoff": cutoff,
        "decision_time": iso(analysis.decision_time(d, cutoff)),
        "forecast_publish_times": pubs,
        "series": series,
        "coverage": analysis.coverage(ds, d, d, cutoff),
        "calibration": training,
        "summary": {
            "forecast_mean": round(sum(fc) / len(fc), 1) if fc else None,
            "forecast_min": min(fc) if fc else None,
            "forecast_max": max(fc) if fc else None,
            "forecast_energy_mwh": round(sum(fc) * 0.5, 1) if len(fc) == 48 else None,
            "buffer_mw": buffer,
        },
        "day_metrics": analysis.metrics(rows),
    }


@app.get("/api/day")
def day(date_: str = Query(..., alias="date"), cutoff: str = analysis.DEFAULT_CUTOFF):
    return day_payload(_delivery(date_), _cutoff(cutoff))


def _range(start: str | None, end: str | None):
    s, e = _delivery(start) if start else TARGET_START, _delivery(end) if end else TARGET_END
    if s > e:
        raise HTTPException(422, "start must be on or before end")
    return s, e


@app.get("/api/accuracy")
def accuracy(cutoff: str = analysis.DEFAULT_CUTOFF, start: str | None = None, end: str | None = None):
    s, e = _range(start, end)
    cutoff = _cutoff(cutoff)
    return {"cutoff": cutoff, "start": str(s), "end": str(e), **analysis.accuracy(dataset(), s, e, cutoff)}


@app.get("/api/horizon")
def horizon(start: str | None = None, end: str | None = None):
    s, e = _range(start, end)
    return {"start": str(s), "end": str(e), "buckets": analysis.horizon_analysis(dataset(), s, e)}


@app.get("/api/export/day.csv")
def export_day(date_: str = Query(..., alias="date"), cutoff: str = analysis.DEFAULT_CUTOFF):
    payload = day_payload(_delivery(date_), _cutoff(cutoff))
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(
        [
            "source",
            "decision_time_utc",
            "delivery_time_utc",
            "forecast_publish_time_utc",
            "forecast_mw",
            "actual_mw_hindsight",
            "error_mw_forecast_minus_actual",
            "historical_lower_estimate_mw",
            "lead_hours",
        ]
    )
    for r in payload["series"]:
        writer.writerow(
            [
                dataset().source,
                payload["decision_time"],
                r["t"],
                r["publishTime"],
                r["forecast"],
                r["actual"],
                r["error"],
                r["lower_estimate"],
                r["lead_hours"],
            ]
        )
    filename = f"windwatch-{payload['date']}-{payload['cutoff'].replace(':', '')}.csv"
    return Response(
        output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"


@app.get("/api/{path:path}", include_in_schema=False)
def missing_api(path: str):
    raise HTTPException(404, "Unknown API endpoint")


if (_dist / "assets").is_dir():
    app.mount("/assets", StaticFiles(directory=_dist / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        candidate = (_dist / path).resolve()
        if not candidate.is_relative_to(_dist.resolve()):
            raise HTTPException(404, "Not found")
        return FileResponse(candidate if path and candidate.is_file() else _dist / "index.html")
