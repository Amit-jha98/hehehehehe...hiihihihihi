from datetime import date, datetime, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import analysis, main
from backend.app.store import build

U = timezone.utc


def mk():
    # Delivery day 2026-01-02. Decision 09:00 on 01-01.
    fc = [
        {"publishTime": "2026-01-01T06:30:00Z", "startTime": "2026-01-02T00:00:00Z", "generation": 100},
        {
            "publishTime": "2026-01-01T08:30:00Z",
            "startTime": "2026-01-02T00:00:00Z",
            "generation": 120,
        },  # latest <= 09:00
        {
            "publishTime": "2026-01-01T10:30:00Z",
            "startTime": "2026-01-02T00:00:00Z",
            "generation": 999,
        },  # after cutoff: must be ignored
    ]
    ac = [
        {"startTime": "2026-01-02T00:00:00Z", "generation": 100},
        {"startTime": "2026-01-02T00:30:00Z", "generation": 140},
    ]
    return build("elexon", ac, fc)


def test_selects_latest_forecast_before_cutoff():
    ds = mk()
    f = analysis.forecast_for(
        ds, datetime(2026, 1, 2, 0, 0, tzinfo=U), analysis.decision_time(date(2026, 1, 2), "09:00")
    )
    assert f[1] == 120 and f[0].hour == 8


def test_forecast_held_over_both_half_hours():
    rows = analysis.pairs(mk(), date(2026, 1, 2), date(2026, 1, 2), "09:00")
    assert [r["forecast"] for r in rows] == [120, 120]
    assert [r["error"] for r in rows] == [20, -20]  # forecast - actual


def test_metrics():
    m = analysis.metrics(analysis.pairs(mk(), date(2026, 1, 2), date(2026, 1, 2), "09:00"))
    assert m["n"] == 2 and m["mae"] == 20 and m["rmse"] == 20 and m["bias"] == 0
    assert m["wape_pct"] == pytest.approx(100 * 40 / 240, abs=0.01)


def test_cutoff_changes_vintage():
    rows = analysis.pairs(mk(), date(2026, 1, 2), date(2026, 1, 2), "07:00")
    assert rows[0]["forecast"] == 100  # only the 06:30 vintage existed


def test_no_forecast_before_any_vintage():
    assert analysis.pairs(mk(), date(2026, 1, 2), date(2026, 1, 2), "05:00") == []


def test_quantile():
    assert analysis.quantile([1, 2, 3, 4], 0.5) == 2.5
    assert analysis.quantile([5], 0.9) == 5


def test_risk_buffer_sign():
    # over-forecast by 20 once, under by 20 once -> actual-forecast = {-20, +20}
    rb = analysis.risk_buffer(analysis.pairs(mk(), date(2026, 1, 2), date(2026, 1, 2), "09:00"))
    assert rb["p5"] < 0 < rb["p95"]


def test_horizon_buckets():
    out = analysis.horizon_analysis(mk(), date(2026, 1, 2), date(2026, 1, 2), bucket_h=6, max_h=48)
    assert out and all(b["from_h"] >= 0 for b in out)


def test_api(monkeypatch):
    monkeypatch.setattr(main, "dataset", lambda: mk())
    c = TestClient(main.app)
    assert c.get("/api/meta").json()["days"] == ["2026-01-02"]
    d = c.get("/api/day", params={"date": "2026-01-02", "cutoff": "09:00"}).json()
    assert len(d["series"]) == 48 and d["series"][0]["forecast"] == 120
    assert c.get("/api/accuracy", params={"cutoff": "09:00"}).json()["overall"]["n"] == 2
    assert c.get("/api/day", params={"date": "nope"}).status_code == 422
    assert c.get("/api/day", params={"date": "2026-01-02", "cutoff": "x"}).status_code == 422
    assert c.get("/api/day", params={"date": "2025-05-05"}).status_code == 422
    assert c.get("/api/day", params={"date": "2026-01-03"}).status_code == 404
