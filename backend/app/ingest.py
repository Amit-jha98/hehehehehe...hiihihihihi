"""Import the Elexon data needed for January 2026 purchase decisions.

Writes an atomic snapshot only after validation. No runtime network dependency.
"""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timedelta, timezone

import requests

from .scope import DECISION_END, DECISION_START, TARGET_END, TARGET_START
from .store import REAL_FILE, build, iso, parse_ts

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
CHUNK_DAYS = 3


def _get(url: str, params: dict) -> list[dict]:
    for attempt in range(5):
        try:
            response = requests.get(url, params=params, timeout=(10, 90))
            if response.status_code not in (429, 500, 502, 503, 504):
                response.raise_for_status()
                payload = response.json()
                if not isinstance(payload, list) or not all(isinstance(r, dict) for r in payload):
                    raise ValueError("Expected an Elexon JSON array of records")
                return payload
            if attempt == 4:
                response.raise_for_status()
            retry_after = response.headers.get("Retry-After", "")
            delay = min(float(retry_after), 30) if retry_after.isdigit() else 2**attempt
        except (requests.Timeout, requests.ConnectionError):
            if attempt == 4:
                raise
            delay = 2**attempt
        time.sleep(delay)
    raise RuntimeError(f"Elexon request failed: {url}")


def fetch_actuals() -> list[dict]:
    out, d = [], TARGET_START
    while d <= TARGET_END:
        end = min(d + timedelta(days=CHUNK_DAYS - 1), TARGET_END)
        rows = _get(
            f"{BASE}/FUELHH/stream",
            {
                "settlementDateFrom": d.isoformat(),
                "settlementDateTo": end.isoformat(),
                "fuelType": "WIND",
            },
        )
        for r in rows:
            if r.get("fuelType") == "WIND" and TARGET_START <= parse_ts(r["startTime"]).date() <= TARGET_END:
                out.append({k: r[k] for k in ("startTime", "publishTime", "generation")})
        print(f"actuals {d}..{end}: {len(rows)} rows", file=sys.stderr, flush=True)
        d = end + timedelta(days=1)
    return out


def fetch_forecasts() -> list[dict]:
    out = []
    # Earlier vintages matter when a decision-day publication is missing.
    t = datetime.combine(DECISION_START - timedelta(days=3), datetime.min.time(), timezone.utc)
    end = datetime.combine(TARGET_END + timedelta(days=1), datetime.min.time(), timezone.utc)
    while t < end:
        nxt = min(t + timedelta(days=CHUNK_DAYS), end)
        rows = _get(
            f"{BASE}/WINDFOR/stream",
            {
                "publishDateTimeFrom": iso(t),
                "publishDateTimeTo": iso(nxt),
            },
        )
        for r in rows:
            if TARGET_START <= parse_ts(r["startTime"]).date() <= TARGET_END:
                out.append({k: r[k] for k in ("startTime", "publishTime", "generation")})
        print(f"forecasts published {t:%F}..{nxt:%F}: {len(rows)} rows", file=sys.stderr, flush=True)
        t = nxt
    return out


def save_snapshot(actuals, forecasts, path=REAL_FILE):
    from . import analysis

    generated_at = iso(datetime.now(timezone.utc).replace(microsecond=0))
    ds = build("elexon", actuals, forecasts, generated_at)
    report = analysis.coverage(ds, TARGET_START, TARGET_END, analysis.DEFAULT_CUTOFF)
    if (
        report["actual_intervals"] != report["expected_intervals"]
        or report["forecast_intervals"] != report["expected_intervals"]
    ):
        raise ValueError(f"Incomplete Elexon snapshot; keeping the previous dataset. Coverage: {report}")
    clean_actuals = [
        {
            "startTime": iso(t),
            "generation": mw,
            **({"publishTime": iso(ds.actual_publish[t])} if t in ds.actual_publish else {}),
        }
        for t, mw in sorted(ds.actuals.items())
    ]
    clean_forecasts = [
        {"startTime": iso(t), "publishTime": iso(pub), "generation": mw}
        for t, vintages in sorted(ds.forecasts.items())
        for pub, mw in vintages
    ]
    payload = {
        "source": "elexon",
        "generated_at": generated_at,
        "scope": {"decision_start": str(DECISION_START), "decision_end": str(DECISION_END)},
        "quality": {"ingestion": ds.quality, "coverage_at_default_cutoff": report},
        "actuals": clean_actuals,
        "forecasts": clean_forecasts,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".json.tmp")
    try:
        temporary.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)
    return ds


def main():
    ds = save_snapshot(fetch_actuals(), fetch_forecasts())
    print(
        f"wrote {REAL_FILE}: {len(ds.actuals)} actuals, "
        f"{sum(map(len, ds.forecasts.values()))} forecast vintages",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
