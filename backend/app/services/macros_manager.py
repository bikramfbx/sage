"""Macros manager: service-layer wrapper around skills.macro_tracker.

Single entry point for the vision food pipeline: appends a meal estimated
from an uploaded image to today's intake and returns the refreshed daily
totals for immediate UI feedback.
"""

from typing import Any, Dict, Optional

from skills.macro_tracker import MacroTracker


class MacrosManager:
    def __init__(self, tracker: MacroTracker):
        self.tracker = tracker

    def log_meal(
        self,
        label: str,
        calories: float,
        protein: float,
        carbs: Optional[float] = None,
        fats: Optional[float] = None,
    ) -> Dict[str, Any]:
        entry = self.tracker.add_intake(
            label=str(label)[:200],
            calories=float(calories),
            protein=float(protein),
            carbs=carbs,
            fats=fats,
        )
        return {
            "entry": entry,
            "duplicate": bool(entry.get("duplicate")),
            "today_totals": self.tracker.today_totals(),
            "targets": self.tracker.targets,
        }
