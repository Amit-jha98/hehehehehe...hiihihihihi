"""Generate a SYNTHETIC dataset with the same schema as the Elexon extract.

For local development / tests only. The output is flagged source="synthetic" and the
UI shows a banner. Real data: `python -m backend.app.ingest`.
"""

import json
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from backend.app.scope import TARGET_END, TARGET_START

OUT = Path(__file__).resolve().parent.parent / "data" / "sample_wind_jan2026.json"
rng = random.Random(42)
U = timezone.utc


def iso(d):
    return d.strftime("%Y-%m-%dT%H:%M:%SZ")


t0 = datetime(2025, 12, 30, tzinfo=U)
t1 = datetime(2026, 2, 3, tzinfo=U)
n = int((t1 - t0) / timedelta(minutes=30))
truth, x = [], 0.0
for _ in range(n):  # slowly varying wind, 1.5-19 GW
    x = 0.985 * x + rng.gauss(0, 0.16)
    truth.append(min(19000, max(1500, 9500 + 5200 * x + rng.gauss(0, 120))))


def at(t):
    return truth[int((t - t0) / timedelta(minutes=30))]


start = datetime.combine(TARGET_START, datetime.min.time(), U)
end = datetime.combine(TARGET_END + timedelta(days=1), datetime.min.time(), U)
actuals = [
    {"startTime": iso(t), "publishTime": iso(t + timedelta(minutes=30)), "generation": round(at(t))}
    for t in (start + i * timedelta(minutes=30) for i in range(31 * 48))
]

forecasts, pub = [], datetime(2025, 12, 31, 0, 30, tzinfo=U)
while pub < end:
    noise = 0.0
    for h in range(-3, 73):
        tgt = pub.replace(minute=0) + timedelta(hours=h)
        if not (start <= tgt < end):
            continue
        sd = 350 + 95 * max(h, 0)  # error grows with horizon
        noise = 0.8 * noise + rng.gauss(0, sd * 0.6)
        base = (at(tgt) + at(tgt + timedelta(minutes=30))) / 2
        forecasts.append(
            {"publishTime": iso(pub), "startTime": iso(tgt), "generation": max(0, round(base + noise))}
        )
    pub += timedelta(hours=2)

OUT.write_text(
    json.dumps({"source": "synthetic", "generated_at": "n/a", "actuals": actuals, "forecasts": forecasts})
)
print(f"wrote {OUT}: {len(actuals)} actuals, {len(forecasts)} forecasts")
