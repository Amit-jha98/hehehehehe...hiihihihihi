"""Regression tests for the challenge scope, temporal integrity and data integration."""

import csv
import io
import json
from datetime import date, datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from backend.app import analysis, ingest, main
from backend.app.scope import TARGET_END, TARGET_START
from backend.app.store import REAL_FILE, build, iso, load, parse_ts

UTC = timezone.utc


def full_day(day, forecast=120, actual=100, publication=None):
    start = datetime.combine(day, datetime.min.time(), UTC)
    pub = publication or start - timedelta(hours=16)
    actuals = [
        {
            "startTime": iso(start + timedelta(minutes=30 * i)),
            "publishTime": iso(start + timedelta(minutes=30 * (i + 1))),
            "generation": actual,
        }
        for i in range(48)
    ]
    forecasts = [
        {"startTime": iso(start + timedelta(hours=i)), "publishTime": iso(pub), "generation": forecast}
        for i in range(24)
    ]
    return actuals, forecasts


@pytest.mark.parametrize("value", ["9:00", "09:0", "09:00:00", "24:00", "12:60", "", " 09:00"])
def test_strict_cutoff(value):
    with pytest.raises(ValueError):
        analysis.parse_cutoff(value)


def test_timezone_conversion_and_naive_rejection():
    assert iso(parse_ts("2026-01-02T01:00:00+01:00")) == "2026-01-02T00:00:00Z"
    with pytest.raises(ValueError, match="timezone"):
        parse_ts("2026-01-02T00:00:00")


@pytest.mark.parametrize("generation", [float("nan"), float("inf"), -1, True, "not-a-number"])
def test_invalid_generation_rejected(generation):
    with pytest.raises((ValueError, TypeError)):
        build("elexon", [{"startTime": "2026-01-02T00:00:00Z", "generation": generation}], [])


def test_missing_generation_is_gap_and_duplicates_deduplicated():
    ac, fc = full_day(TARGET_START)
    ds = build("elexon", ac + [ac[0], {**ac[1], "generation": None}], fc + [fc[0]])
    assert len(ds.actuals) == 48 and sum(map(len, ds.forecasts.values())) == 24
    assert ds.quality["duplicate_rows_removed"] == 2
    assert ds.quality["missing_generation_rows"] == 1


def test_conflicting_vintage_is_not_silently_chosen():
    ac, fc = full_day(TARGET_START)
    with pytest.raises(ValueError, match="Conflicting forecast"):
        build("elexon", ac, fc + [{**fc[0], "generation": 900}])


def test_actual_revision_selection_is_independent_of_input_order():
    ac, _ = full_day(TARGET_START)
    revision = {**ac[0], "publishTime": "2026-01-05T00:00:00Z", "generation": 999}
    for rows in ([ac[0], revision], [revision, ac[0]]):
        ds = build("elexon", rows, [])
        assert next(iter(ds.actuals.values())) == 999
        assert iso(next(iter(ds.actual_publish.values()))) == revision["publishTime"]


def test_equality_at_cutoff_is_available():
    ac, fc = full_day(TARGET_START, publication=datetime(2026, 1, 1, 9, tzinfo=UTC))
    ds = build("elexon", ac, fc)
    assert analysis.day_series(ds, TARGET_START, "09:00")[0]["forecast"] == 120
    assert analysis.day_series(ds, TARGET_START, "08:59")[0]["forecast"] is None


def test_forecast_only_day_remains_available():
    _, fc = full_day(TARGET_END)
    ds = build("elexon", [], fc)
    assert analysis.available_days(ds) == [TARGET_END]
    report = analysis.coverage(ds, TARGET_END, TARGET_END, "09:00")
    assert report["forecast_intervals"] == 48 and report["actual_intervals"] == 0


def test_zero_actual_wape_undefined_and_empty_metrics_stable():
    rows = [{"actual": 0, "error": 10}]
    assert analysis.metrics(rows)["wape_pct"] is None
    assert analysis.metrics([])["mae"] is None


def test_calibration_excludes_future_outcomes_and_late_actual_publications():
    ac, fc = full_day(TARGET_START)
    later_ac, later_fc = full_day(date(2026, 1, 4), forecast=10000, actual=0)
    ds = build("elexon", ac + later_ac, fc + later_fc)
    before = analysis.calibration(ds, date(2026, 1, 4), "09:00")
    assert before["n"] == 48 and before["end"] == "2026-01-02"
    assert before["risk_buffer"]["p10"] == -20
    for t in ds.actuals:
        if t.date() == TARGET_START:
            ds.actual_publish[t] = datetime(2026, 1, 10, tzinfo=UTC)
    after = analysis.calibration(ds, date(2026, 1, 4), "09:00")
    assert after["n"] == 0 and not after["sufficient"]
    assert after["risk_buffer"] == {}


def test_early_decision_does_not_borrow_month_history():
    ac, fc = full_day(TARGET_START)
    ds = build("elexon", ac, fc)
    assert analysis.calibration(ds, TARGET_START, "09:00")["n"] == 0


def test_horizon_uses_each_half_hour_target_for_bucket_boundary():
    ac, fc = full_day(TARGET_START)
    # 00:00 has 5.5h lead; 00:30 has 6h lead.
    fc = [{**fc[0], "publishTime": "2026-01-01T18:30:00Z"}]
    ds = build("elexon", ac[:2], fc)
    buckets = analysis.horizon_analysis(ds, TARGET_START, TARGET_START)
    assert [(b["from_h"], b["n"]) for b in buckets] == [(0, 1), (6, 1)]


@pytest.fixture
def client(monkeypatch):
    ac, fc = full_day(TARGET_END)
    monkeypatch.setattr(main, "dataset", lambda: build("elexon", ac, fc))
    return TestClient(main.app)


def test_january_31_decision_includes_february_1_delivery_and_csv(client):
    result = client.get("/api/day", params={"date": "2026-02-01"})
    assert result.status_code == 200
    body = result.json()
    assert body["decision_time"] == "2026-01-31T09:00:00Z"
    assert body["summary"]["forecast_energy_mwh"] == 2880
    assert body["coverage"]["matched_pct"] == 100
    exported = client.get("/api/export/day.csv?date=2026-02-01")
    assert exported.headers["content-type"].startswith("text/csv")
    assert "windwatch-2026-02-01-0900.csv" in exported.headers["content-disposition"]
    rows = list(csv.DictReader(io.StringIO(exported.text)))
    assert len(rows) == 48 and rows[0]["actual_mw_hindsight"] == "100.0"
    assert rows[0]["source"] == "elexon"
    assert rows[0]["historical_lower_estimate_mw"] == ""


@pytest.mark.parametrize(
    "query",
    [
        "start=2026-01-10&end=2026-01-02",
        "start=2025-01-01",
        "end=2030-01-01",
        "start=20260102",
        "cutoff=24:00",
    ],
)
def test_invalid_api_range_and_cutoff_are_rejected(client, query):
    assert client.get(f"/api/accuracy?{query}").status_code == 422


def test_unknown_api_stays_json_and_headers_present(client):
    response = client.get("/api/does-not-exist")
    assert response.status_code == 404
    assert response.json()["detail"] == "Unknown API endpoint"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["cache-control"] == "no-cache"


def test_empty_dataset_returns_empty_analysis_and_unhealthy(monkeypatch):
    monkeypatch.setattr(main, "dataset", lambda: build("elexon", [], []))
    client = TestClient(main.app)
    assert client.get("/api/meta").json()["days"] == []
    assert client.get("/api/health").status_code == 503
    body = client.get("/api/accuracy").json()
    assert body["overall"]["n"] == 0 and body["overall"]["mae"] is None
    assert len(body["daily"]) == 31


def test_incomplete_import_keeps_existing_snapshot(tmp_path):
    target = tmp_path / "dataset.json"
    target.write_text("previous snapshot", encoding="utf-8")
    with pytest.raises(ValueError, match="Incomplete"):
        ingest.save_snapshot([], [], target)
    assert target.read_text() == "previous snapshot"
    assert not target.with_suffix(".json.tmp").exists()


def test_import_retries_transient_connection_errors(monkeypatch):
    calls = []

    def get(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            raise ingest.requests.ConnectionError("network interrupted")
        response = ingest.requests.Response()
        response.status_code = 200
        response._content = b"[]"
        return response

    monkeypatch.setattr(ingest.requests, "get", get)
    monkeypatch.setattr(ingest.time, "sleep", lambda _: None)
    assert ingest._get("https://example.com", {}) == []
    assert len(calls) == 2


def test_loader_honors_explicit_dataset_and_fails_on_corruption(tmp_path, monkeypatch):
    file = tmp_path / "sample.json"
    ac, fc = full_day(TARGET_START)
    file.write_text(json.dumps({"source": "synthetic", "actuals": ac, "forecasts": fc}))
    monkeypatch.setenv("WINDWATCH_DATA_FILE", str(file))
    assert load().is_synthetic
    file.write_text("invalid JSON")
    with pytest.raises(ValueError):
        load()


def test_bundled_real_snapshot_is_complete_and_no_future_vintage_is_selected():
    ds = load(REAL_FILE)
    assert not ds.is_synthetic
    assert len(ds.actuals) == 1488
    assert len(ds.forecasts) == 744
    assert len(ds.actual_publish) == 1488
    assert analysis.available_days(ds)[0] == TARGET_START
    assert analysis.available_days(ds)[-1] == TARGET_END
    for cutoff in ("00:00", "09:00", "23:59"):
        report = analysis.coverage(ds, TARGET_START, TARGET_END, cutoff)
        assert report["actual_intervals"] == 1488
        if cutoff == "09:00":
            assert report["matched_pct"] == 100
        for i in range(31):
            day = TARGET_START + timedelta(days=i)
            decision = analysis.decision_time(day, cutoff)
            for row in analysis.day_series(ds, day, cutoff):
                hour = parse_ts(row["t"]).replace(minute=0)
                if row["publishTime"] is None:
                    assert not any(candidate <= decision for candidate, _ in ds.forecasts[hour])
                    continue
                pub = parse_ts(row["publishTime"])
                assert pub <= decision
                assert not any(pub < candidate <= decision for candidate, _ in ds.forecasts[hour])
