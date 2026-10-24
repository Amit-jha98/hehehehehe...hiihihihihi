"""Pure analysis functions (no web framework, no pandas) so they're easy to test.

Conventions
-----------
* All times are UTC. In January UK local time == UTC, so "delivery day" is unambiguous.
* error = forecast - actual.  Positive error = wind OVER-forecast = the buyer
  would under-procure from other sources (shortfall risk).
* WINDFOR is hourly, FUELHH is 30-min: a forecast for hour H is held flat over
  both half-hours of H when compared with actuals.
* Decision rule: for delivery day D the buyer decides on D-1 at `cutoff`
  (HH:MM UTC). The forecast "available" for a target time is the latest
  vintage with publishTime <= that decision time.
"""

from __future__ import annotations

import math
import re
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

from .scope import TARGET_END, TARGET_START
from .store import Dataset

HALF_HOUR = timedelta(minutes=30)
DEFAULT_CUTOFF = "09:00"


def parse_cutoff(s: str) -> time:
    if not re.fullmatch(r"\d{2}:\d{2}", s):
        raise ValueError("cutoff must be HH:MM")
    h, m = s.split(":")
    t = time(int(h), int(m))
    return t


def decision_time(day: date, cutoff: str) -> datetime:
    t = parse_cutoff(cutoff)
    return datetime.combine(day - timedelta(days=1), t, timezone.utc)


def forecast_for(ds: Dataset, target: datetime, decision: datetime):
    """Latest (publishTime, MW) forecast for the hour containing `target` published <= decision."""
    hour = target.replace(minute=0, second=0, microsecond=0)
    best = None
    for pub, mw in ds.forecasts.get(hour, []):
        if pub <= decision:
            best = (pub, mw)
        else:
            break
    return best


def day_series(ds: Dataset, day: date, cutoff: str) -> list[dict]:
    """Half-hourly points for one delivery day with the decision-time forecast."""
    dec = decision_time(day, cutoff)
    start = datetime.combine(day, time(0), timezone.utc)
    rows = []
    for i in range(48):
        t = start + i * HALF_HOUR
        f = forecast_for(ds, t, dec)
        rows.append(
            {
                "t": t.isoformat().replace("+00:00", "Z"),
                "actual": ds.actuals.get(t),
                "forecast": f[1] if f else None,
                "publishTime": f[0].isoformat().replace("+00:00", "Z") if f else None,
                "error": f[1] - ds.actuals[t] if f and t in ds.actuals else None,
                "lead_hours": round((t - f[0]).total_seconds() / 3600, 2) if f else None,
            }
        )
    return rows


def pairs(ds: Dataset, start: date, end: date, cutoff: str) -> list[dict]:
    """All (forecast, actual) pairs for delivery days start..end inclusive."""
    out = []
    d = start
    while d <= end:
        for r in day_series(ds, d, cutoff):
            if r["actual"] is not None and r["forecast"] is not None:
                t = datetime.fromisoformat(r["t"].replace("Z", "+00:00"))
                out.append(
                    {
                        "t": t,
                        "day": d,
                        "actual": r["actual"],
                        "forecast": r["forecast"],
                        "error": r["forecast"] - r["actual"],
                        "publish": datetime.fromisoformat(r["publishTime"].replace("Z", "+00:00")),
                    }
                )
        d += timedelta(days=1)
    return out


def quantile(xs: list[float], q: float) -> float:
    """Linear-interpolated quantile (same as numpy default)."""
    if not xs:
        return float("nan")
    s = sorted(xs)
    pos = (len(s) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def _round(x, n=1):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(x, n)


def metrics(rows: list[dict]) -> dict:
    n = len(rows)
    if n == 0:
        return {
            "n": 0,
            **dict.fromkeys(
                ("mae", "rmse", "bias", "wape_pct", "mean_actual", "p50_abs", "p90_abs", "p95_abs", "max_abs")
            ),
        }
    errs = [r["error"] for r in rows]
    abs_errs = [abs(e) for e in errs]
    sum_actual = sum(r["actual"] for r in rows)
    return {
        "n": n,
        "mae": _round(sum(abs_errs) / n),
        "rmse": _round(math.sqrt(sum(e * e for e in errs) / n)),
        "bias": _round(sum(errs) / n),
        "wape_pct": _round(100 * sum(abs_errs) / sum_actual, 2) if sum_actual > 0 else None,
        "mean_actual": _round(sum_actual / n),
        "p50_abs": _round(quantile(abs_errs, 0.5)),
        "p90_abs": _round(quantile(abs_errs, 0.9)),
        "p95_abs": _round(quantile(abs_errs, 0.95)),
        "max_abs": _round(max(abs_errs)),
    }


def risk_buffer(rows: list[dict]) -> dict:
    """Empirical (actual - forecast) quantiles: how much *less* wind than forecast to plan for."""
    shortfalls = [-r["error"] for r in rows]  # actual - forecast
    if not shortfalls:
        return {}
    return {f"p{int(q * 100)}": _round(quantile(shortfalls, q)) for q in (0.05, 0.10, 0.50, 0.90, 0.95)}


def accuracy(ds: Dataset, start: date, end: date, cutoff: str) -> dict:
    rows = pairs(ds, start, end, cutoff)
    by_day, by_hour = defaultdict(list), defaultdict(list)
    for r in rows:
        by_day[r["day"]].append(r)
        by_hour[r["t"].hour].append(r)
    errs = [r["error"] for r in rows]
    hist = []
    if errs:
        width = 1000  # MW buckets
        lo = math.floor(min(errs) / width) * width
        hi = math.ceil((max(errs) + 1e-9) / width) * width
        edges = list(range(int(lo), int(hi) + width, width))
        counts = [0] * (len(edges) - 1)
        for e in errs:
            counts[min(int((e - lo) // width), len(counts) - 1)] += 1
        hist = [{"from": edges[i], "to": edges[i + 1], "count": c} for i, c in enumerate(counts)]
    return {
        "coverage": coverage(ds, start, end, cutoff),
        "overall": metrics(rows),
        "risk_buffer": risk_buffer(rows),
        "daily": [
            {"date": (start + timedelta(days=i)).isoformat(), **metrics(by_day[start + timedelta(days=i)])}
            for i in range((end - start).days + 1)
        ],
        "by_hour": [{"hour": h, **metrics(v)} for h, v in sorted(by_hour.items())],
        "histogram": hist,
    }


def horizon_analysis(ds: Dataset, start: date, end: date, bucket_h: int = 6, max_h: int = 48) -> list[dict]:
    """Error vs forecast horizon (hours between publishTime and target start), all vintages."""
    buckets = defaultdict(list)
    lo = datetime.combine(start, time(0), timezone.utc)
    hi = datetime.combine(end + timedelta(days=1), time(0), timezone.utc)
    for hour, vs in ds.forecasts.items():
        for pub, mw in vs:
            for k in (0, 1):
                t = hour + k * HALF_HOUR
                h = (t - pub).total_seconds() / 3600
                if h < 0 or h >= max_h:
                    continue
                if not (lo <= t < hi) or t not in ds.actuals:
                    continue
                a = ds.actuals[t]
                buckets[int(h // bucket_h)].append({"actual": a, "error": mw - a})
    out = []
    for b, v in sorted(buckets.items()):
        out.append({"from_h": b * bucket_h, "to_h": (b + 1) * bucket_h, **metrics(v)})
    return out


def available_days(ds: Dataset) -> list[date]:
    return sorted({t.date() for t in (*ds.actuals, *ds.forecasts) if TARGET_START <= t.date() <= TARGET_END})


def coverage(ds: Dataset, start: date, end: date, cutoff: str) -> dict:
    expected = max(0, (end - start).days + 1) * 48
    actual = forecast = matched = 0
    d = start
    while d <= end:
        for row in day_series(ds, d, cutoff):
            a, f = row["actual"] is not None, row["forecast"] is not None
            actual += a
            forecast += f
            matched += a and f
        d += timedelta(days=1)
    return {
        "expected_intervals": expected,
        "actual_intervals": actual,
        "forecast_intervals": forecast,
        "matched_intervals": matched,
        "missing_actual_intervals": expected - actual,
        "missing_forecast_intervals": expected - forecast,
        "matched_pct": round(matched / expected * 100, 2) if expected else 0,
    }


def calibration(ds: Dataset, day: date, cutoff: str) -> dict:
    """Only completed delivery days and actuals published by this decision.

    This is a small historical sample, never a calibrated confidence guarantee.
    Actuals without publication metadata are excluded from decision-time calibration.
    """
    decision = decision_time(day, cutoff)
    end = decision.date() - timedelta(days=1)
    rows = [
        r
        for r in pairs(ds, TARGET_START, end, cutoff)
        if r["t"] in ds.actual_publish and ds.actual_publish[r["t"]] <= decision
    ]
    sufficient = len(rows) >= 48
    return {
        "n": len(rows),
        "days": len({r["day"] for r in rows}),
        "start": min(r["day"] for r in rows).isoformat() if rows else None,
        "end": max(r["day"] for r in rows).isoformat() if rows else None,
        "as_of": decision.isoformat().replace("+00:00", "Z"),
        "minimum_intervals": 48,
        "sufficient": sufficient,
        "risk_buffer": risk_buffer(rows) if sufficient else {},
    }
