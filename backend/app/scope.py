"""The challenge is scoped by purchase decision date, not delivery date."""

from datetime import date, timedelta

DECISION_START = date(2026, 1, 1)
DECISION_END = date(2026, 1, 31)
TARGET_START = DECISION_START + timedelta(days=1)
TARGET_END = DECISION_END + timedelta(days=1)


def delivery_days():
    return [TARGET_START + timedelta(days=i) for i in range((TARGET_END - TARGET_START).days + 1)]
