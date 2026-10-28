"""Macro tracking skill for SAGE.

Maintains daily caloric/protein intake, computes progress against
daily targets, and persists tracking state under sandbox/state/.
"""

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STATE_PATH = REPO_ROOT / "sandbox" / "state" / "macros.json"

DEFAULT_TARGETS = {"calories": 2500, "protein": 150}

# Matches phrases like "ate 600 kcal with 40g protein chicken and rice"
# or "logged 500 cal / 30 protein oats"
_FOOD_PATTERNS = [
    re.compile(r"(?P<cal>\d{2,4})\s*(?:kcal|cals?|calories)", re.IGNORECASE),
    re.compile(r"(?:calories?|kcal)\s*(?:of|at|:)?\s*(?P<cal>\d{2,4})", re.IGNORECASE),
    re.compile(r"(?P<protein>\d{1,3})\s*(?:g|grams?)?\s*(?:of\s*)?protein", re.IGNORECASE),
    re.compile(r"(?:protein\s*(?:at|:|of)?)\s*(?P<protein>\d{1,3})\s*(?:g|grams?)?\b", re.IGNORECASE),
]

_FOOD_TRIGGER = re.compile(
    r"\b(ate|eaten|eat|logged|log|had|consumed|tracking|breakfast|lunch|dinner|snack|meal)\b",
    re.IGNORECASE,
)


def looks_like_food_message(text: str) -> bool:
    return bool(_FOOD_TRIGGER.search(text))


def parse_food_message(text: str) -> Optional[Dict[str, Any]]:
    """Extract calories/protein numbers from a natural-language food log."""
    calories = None
    protein = None
    for pattern in _FOOD_PATTERNS[:2]:
        m = pattern.search(text)
        if m:
            calories = int(m.group("cal"))
            break
    for pattern in _FOOD_PATTERNS[2:]:
        m = pattern.search(text)
        if m:
            protein = int(m.group("protein"))
            break
    if calories is None and protein is None:
        return None
    label = text.strip()
    label = re.sub(r"^(ate|eaten|log(?:ged)?|had|consumed)\b[:\s]*", "", label, flags=re.IGNORECASE)
    return {
        "label": label[:80],
        "calories": calories or 0,
        "protein": protein or 0,
    }


class MacroTracker:
    def __init__(self, state_path: Path = DEFAULT_STATE_PATH, targets: Optional[Dict[str, int]] = None):
        self.state_path = Path(state_path)
        self.targets = dict(DEFAULT_TARGETS if targets is None else targets)
        self.entries: List[Dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        if not self.state_path.exists():
            return
        try:
            data = json.loads(self.state_path.read_text(encoding="utf-8"))
            self.targets = data.get("targets", self.targets)
            self.entries = data.get("entries", [])
        except (json.JSONDecodeError, OSError):
            pass

    def _save(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(
            json.dumps({"targets": self.targets, "entries": self.entries}, indent=2),
            encoding="utf-8",
        )

    def add_intake(
        self, label: str, calories: float, protein: float, dedupe: bool = True
    ) -> Dict[str, Any]:
        if dedupe:
            normalized = " ".join(str(label).lower().split())
            today = datetime.now().date().isoformat()
            for existing in self.entries:
                if not existing["time"].startswith(today):
                    continue
                same_label = " ".join(existing["label"].lower().split()) == normalized
                same_macros = (
                    abs(existing["calories"] - calories) < 1e-9
                    and abs(existing["protein"] - protein) < 1e-9
                )
                if same_label and same_macros:
                    duplicate = dict(existing)
                    duplicate["duplicate"] = True
                    return duplicate
        entry = {
            "label": label,
            "calories": calories,
            "protein": protein,
            "time": datetime.now().isoformat(timespec="seconds"),
        }
        self.entries.append(entry)
        self._save()
        return entry

    def today_totals(self) -> Dict[str, float]:
        today = datetime.now().date().isoformat()
        calories = sum(e["calories"] for e in self.entries if e["time"].startswith(today))
        protein = sum(e["protein"] for e in self.entries if e["time"].startswith(today))
        return {"calories": calories, "protein": protein}

    def today_entries(self) -> List[Dict[str, Any]]:
        today = datetime.now().date().isoformat()
        return [e for e in self.entries if e["time"].startswith(today)]

    def state(self) -> Dict[str, Any]:
        totals = self.today_totals()
        return {
            "date": datetime.now().date().isoformat(),
            "totals": totals,
            "targets": self.targets,
            "entries": self.today_entries(),
        }
