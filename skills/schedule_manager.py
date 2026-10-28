"""Schedule management skill for SAGE.

Owns calendar state in sandbox/state/schedule.json (seeded from the
legacy sandbox/calendar/events.json on first use). Supports single
event creation, bulk timetable ingestion, and upcoming-event queries.
"""

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_STATE_PATH = REPO_ROOT / "sandbox" / "state" / "schedule.json"
DEFAULT_SEED_PATH = REPO_ROOT / "sandbox" / "calendar" / "events.json"

DAYS = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}

_DAY_TOKEN = r"(?:mon(?:day)?|tue(?:s)?(?:day)?|wed(?:nesday)?|thu(?:r)?(?:sday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)"
_TIME_RE = re.compile(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", re.IGNORECASE)
_CODE_RE = re.compile(r"\b([A-Z]{2,4}-\d{3}[A-Z]?)\b")


def parse_datetime(value: str) -> datetime:
    """Tolerant datetime parser: ISO 8601 first, common formats after."""
    v = value.strip().replace("Z", "+00:00")
    try:
        return datetime.fromisoformat(v)
    except ValueError:
        pass
    for fmt in (
        "%Y-%m-%d %H:%M", "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M",
        "%d %B %Y %H:%M", "%d/%m/%Y %H:%M", "%m/%d/%Y %H:%M",
        "%Y-%m-%d", "%d %B %Y",
    ):
        try:
            return datetime.strptime(v, fmt)
        except ValueError:
            continue
    raise ValueError(f"Could not parse datetime: {value!r} (expected ISO 8601)")


def _next_weekday(day_idx: int, week_hour: int, week_minute: int, weeks: int = 4) -> List[datetime]:
    """Next `weeks` occurrences of a weekday at a given time."""
    now = datetime.now()
    today_idx = now.weekday()
    delta = (day_idx - today_idx) % 7
    first = (now + timedelta(days=delta)).replace(
        hour=week_hour, minute=week_minute, second=0, microsecond=0
    )
    if first <= now:
        first += timedelta(days=7)
    return [first + timedelta(weeks=w) for w in range(weeks)]


class ScheduleManager:
    def __init__(
        self,
        state_path: Path = DEFAULT_STATE_PATH,
        seed_path: Path = DEFAULT_SEED_PATH,
    ):
        self.state_path = Path(state_path)
        self.seed_path = Path(seed_path)
        self.events: List[Dict[str, Any]] = []
        self._load()

    def _load(self) -> None:
        if self.state_path.exists():
            try:
                self.events = json.loads(self.state_path.read_text(encoding="utf-8"))
                return
            except (json.JSONDecodeError, OSError):
                self.events = []
        if self.seed_path.exists():
            try:
                self.events = json.loads(self.seed_path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                self.events = []
        else:
            self.events = []

    def _save(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        self.state_path.write_text(
            json.dumps(self.events, indent=2), encoding="utf-8"
        )

    def add_event(
        self,
        title: str,
        date_time: str,
        location: Optional[str] = None,
        course: Optional[str] = None,
    ) -> Dict[str, Any]:
        when = parse_datetime(date_time)
        code = course or (m.group(1) if (m := _CODE_RE.search(title)) else None)
        event = {
            "id": f"evt-{int(datetime.now().timestamp() * 1000)}",
            "title": title.strip(),
            "date": when.isoformat(timespec="seconds"),
            "location": location,
            "course": code,
        }
        self.events.append(event)
        self._save()
        return event

    def bulk_import_timetable(self, timetable_text: str, weeks: int = 4) -> Dict[str, Any]:
        """Parse a raw weekly timetable into recurring events.

        Handles lines like:
          "Mon 09:00 CS-302 Distributed Systems @ LT-5"
          "Thursday 2:00 PM MA-201 Linear Algebra Room 204"
          "Friday 10:00 Lab session"
        """
        added: List[Dict[str, Any]] = []
        skipped: List[str] = []

        for raw_line in timetable_text.strip().splitlines():
            line = raw_line.strip(" -*•\t")
            if not line:
                continue
            day_match = re.search(rf"\b({_DAY_TOKEN})\b", line, re.IGNORECASE)
            if not day_match:
                skipped.append(line)
                continue
            day_idx = DAYS[day_match.group(1).lower()]

            rest = line[day_match.end():].strip(" :,-\t")
            time_match = _TIME_RE.search(rest)
            if not time_match:
                skipped.append(line)
                continue
            hour = int(time_match.group(1))
            minute = int(time_match.group(2) or 0)
            meridiem = (time_match.group(3) or "").lower()
            if meridiem == "pm" and hour < 12:
                hour += 12
            if meridiem == "am" and hour == 12:
                hour = 0
            if hour > 23:
                skipped.append(line)
                continue

            remainder = (
                rest[: time_match.start()] + " " + rest[time_match.end():]
            ).strip(" -@\t")
            code_m = _CODE_RE.search(remainder)
            course = code_m.group(1) if code_m else None
            text = _CODE_RE.sub("", remainder).strip(" -@\t")

            loc_m = re.search(
                r"(?:\s@\s*|\s+(?:room|rm)\.?\s*[: ]\s*|\s+(?:at|in)\s+)"
                r"(?P<loc>[\w][\w \-/.]*)$",
                text,
                re.IGNORECASE,
            )
            if loc_m and loc_m.start() > 0:
                title = text[: loc_m.start()].strip(" -") or "Class"
                location = loc_m.group("loc").strip() or None
            else:
                title = text or "Class"
                location = None

            for when in _next_weekday(day_idx, hour, minute, weeks):
                ev = self.add_event(
                    title=f"{course or ''} {title}".strip(),
                    date_time=when.isoformat(timespec="seconds"),
                    location=location,
                    course=course,
                )
                added.append(ev)

        if not added and skipped:
            return {
                "ok": False,
                "error": (
                    "No timetable lines could be parsed. Expected lines like "
                    "'Mon 09:00 CS-302 Distributed Systems @ LT-5'."
                ),
                "skipped": skipped[:10],
            }
        self._save()
        return {"ok": True, "added_count": len(added), "added": added[:40], "skipped": skipped[:10]}

    def upcoming(self, limit: int = 8) -> List[Dict[str, Any]]:
        now = datetime.now().isoformat(timespec="seconds")
        upcoming = [e for e in self.events if e.get("date", "") >= now]
        upcoming.sort(key=lambda e: e.get("date", ""))
        return upcoming[:limit]

    def state(self, limit: int = 8) -> List[Dict[str, Any]]:
        return self.upcoming(limit)
