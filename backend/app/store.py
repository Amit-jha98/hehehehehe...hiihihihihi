"""Validated, deterministic loading of Elexon actuals and forecast vintages."""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
REAL_FILE = DATA_DIR / "elexon_wind_jan2026.json"
SAMPLE_FILE = DATA_DIR / "sample_wind_jan2026.json"


def parse_ts(s: str) -> datetime:
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        raise ValueError(f"Timestamp must include a timezone: {s!r}")
    return dt.astimezone(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@dataclass
class Dataset:
    source: str
    actuals: dict[datetime, float] = field(default_factory=dict)
    forecasts: dict[datetime, list[tuple[datetime, float]]] = field(default_factory=dict)
    generated_at: str = ""
    actual_publish: dict[datetime, datetime] = field(default_factory=dict)
    quality: dict = field(default_factory=dict)

    @property
    def is_synthetic(self) -> bool:
        return self.source != "elexon"


def _generation(value) -> float:
    if isinstance(value, bool):
        raise ValueError("Generation must be a finite, nonnegative number")
    mw = float(value)
    if not math.isfinite(mw) or mw < 0:
        raise ValueError("Generation must be a finite, nonnegative number")
    return mw


def _target(row, interval):
    t = parse_ts(row["startTime"])
    if t.minute % interval or t.second or t.microsecond:
        raise ValueError(f"Target must align to a {interval}-minute interval: {iso(t)}")
    return t


def build(source: str, actuals: list[dict], forecasts: list[dict], generated_at: str = "") -> Dataset:
    if source not in {"elexon", "synthetic"}:
        raise ValueError("Unknown dataset source")
    ds = Dataset(source=source, generated_at=generated_at)
    missing, duplicates, revisions = 0, 0, 0
    for r in actuals:
        if r.get("fuelType", "WIND") != "WIND":
            continue
        if r.get("generation") is None:
            missing += 1
            continue
        t, mw = _target(r, 30), _generation(r["generation"])
        pub = parse_ts(r["publishTime"]) if r.get("publishTime") else None
        if t in ds.actuals:
            old_pub = ds.actual_publish.get(t)
            if old_pub != pub and old_pub is not None and pub is not None:
                revisions += 1
                if pub < old_pub:
                    continue
            elif ds.actuals[t] != mw:
                raise ValueError(f"Conflicting actuals for {iso(t)} without distinct publication times")
            else:
                if pub is not None and old_pub is None:
                    ds.actual_publish[t] = pub
                duplicates += 1
                continue
        ds.actuals[t] = mw
        if pub is not None:
            ds.actual_publish[t] = pub
    unique = {}
    for r in forecasts:
        if r.get("generation") is None:
            missing += 1
            continue
        key = (_target(r, 60), parse_ts(r["publishTime"]))
        mw = _generation(r["generation"])
        if key in unique:
            if unique[key] != mw:
                raise ValueError(f"Conflicting forecast vintage for {iso(key[0])} / {iso(key[1])}")
            duplicates += 1
        unique[key] = mw
    for (target, pub), mw in sorted(unique.items()):
        ds.forecasts.setdefault(target, []).append((pub, mw))
    ds.quality = {
        "missing_generation_rows": missing,
        "duplicate_rows_removed": duplicates,
        "actual_revisions_resolved": revisions,
    }
    return ds


def load(path: Path | None = None) -> Dataset:
    configured = os.environ.get("WINDWATCH_DATA_FILE")
    p = path or (Path(configured) if configured else REAL_FILE if REAL_FILE.exists() else SAMPLE_FILE)
    if not p.exists():
        raise FileNotFoundError(f"No dataset at {p}. Run python -m backend.app.ingest.")
    raw = json.loads(p.read_text(encoding="utf-8"))
    ds = build(raw["source"], raw["actuals"], raw["forecasts"], raw.get("generated_at", ""))
    ds.quality = {**raw.get("quality", {}), **ds.quality}
    return ds
