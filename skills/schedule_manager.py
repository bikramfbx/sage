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
_TIME_RE = re.compile(r"(?<![\w])(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", re.IGNORECASE)
_CODE_RE = re.compile(r"\b([A-Z]{2,4}-?\d{3}[A-Z]?)\b")
_LOC_RE = re.compile(
    r"(?:\s?@\s*|\s+(?:room|rm)\.?\s*[: ]\s*|(?:^|\s+)(?:at|in)\s+)"
    r"(?P<loc>[\w][\w \-/.]*)$",
    re.IGNORECASE,
)


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


def _canonical_day(token: str) -> str:
    """Map any day spelling ('Tuesday', 'tues', 'Thu') to a DAYS key."""
    t = token.lower()
    if t in DAYS:
        return t
    prefix = {
        "mon": "mon", "tue": "tue", "tues": "tue", "wed": "wed",
        "thu": "thu", "thur": "thu", "thurs": "thu",
        "fri": "fri", "sat": "sat", "sun": "sun",
    }
    return prefix.get(t[:4], prefix[t[:3]])


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

    def _parse_segment(self, segment: str) -> Optional[Dict[str, Any]]:
        """Parse one timetable segment into day indices, time, title, code, location.

        Handles both "Mon 09:00 CS-302 Distributed Systems @ LT-5" and
        "CS302 Mon/Wed 10 AM in LT-5" shapes, plus multi-day slashes and
        comma-separated entries on a single line.
        """
        seg = segment.strip(" -*•\t")
        if not seg:
            return None

        day_mx = re.search(rf"\b{_DAY_TOKEN}\b", seg, re.IGNORECASE)
        if not day_mx:
            return None
        days = [DAYS[_canonical_day(day_mx.group(0))]]
        end = day_mx.end()
        while True:
            nxt = re.match(rf"\s*/\s*({_DAY_TOKEN})\b", seg[end:], re.IGNORECASE)
            if not nxt:
                break
            days.append(DAYS[_canonical_day(nxt.group(1))])
            end += nxt.end()
        rest = seg[: day_mx.start()] + " " + seg[end:]

        time_mx = _TIME_RE.search(rest)
        if not time_mx:
            return None
        hour = int(time_mx.group(1))
        minute = int(time_mx.group(2) or 0)
        meridiem = (time_mx.group(3) or "").lower()
        if meridiem == "pm" and hour < 12:
            hour += 12
        if meridiem == "am" and hour == 12:
            hour = 0
        # require am/pm or an explicit colon so stray numbers (room 204,
        # course codes) aren't mistaken for wall-clock times
        if hour > 23 or not (meridiem or ":" in time_mx.group(0)):
            return None

        remainder = (
            rest[: time_mx.start()] + " " + rest[time_mx.end() :]
        ).strip(" -@\t")
        code_mx = _CODE_RE.search(remainder)
        course = code_mx.group(1) if code_mx else None
        text = _CODE_RE.sub("", remainder).strip(" -@\t")

        loc_mx = _LOC_RE.search(text)
        title = ""
        location = None
        if loc_mx:
            title = text[: loc_mx.start()].strip(" -@")
            location = loc_mx.group("loc").strip() or None
        else:
            title = text.strip(" -@")
        if not title:
            title = course or "Class"

        return {"days": days, "hour": hour, "minute": minute,
                "title": title, "course": course, "location": location}

    def bulk_import_timetable(self, timetable_text: str, weeks: int = 4) -> Dict[str, Any]:
        """Parse a raw weekly timetable into recurring events.

        Accepts lines like:
          "Mon 09:00 CS-302 Distributed Systems @ LT-5"
          "CS302 Mon/Wed 10 AM in LT-5, OS Lab Tue 2 PM in Lab 2"
        Comma-separated entries on one line and slash-joined day groups
        ("Mon/Wed") are both supported. Re-imports of identical events are
        skipped.
        """
        added: List[Dict[str, Any]] = []
        skipped: List[str] = []
        existing_keys = {
            (e.get("title", ""), e.get("date", ""), e.get("location") or "")
            for e in self.events
        }

        segments: List[str] = []
        for raw_line in timetable_text.strip().splitlines():
            line = raw_line.strip(" -*•\t")
            if not line:
                continue
            if "," in line or ";" in line:
                segments.extend(
                    p.strip() for p in re.split(r"[,;]", line) if p.strip()
                )
            else:
                segments.append(line)

        for segment in segments:
            parsed = self._parse_segment(segment)
            if parsed is None:
                skipped.append(segment)
                continue
            for day_idx in parsed["days"]:
                for when in _next_weekday(day_idx, parsed["hour"], parsed["minute"], weeks):
                    base = parsed["title"]
                    course = parsed["course"]
                    if course and base.lower() != course.lower() and course.lower() not in base.lower():
                        title = f"{course} {base}"
                    else:
                        title = base
                    location = parsed["location"]
                    key = (title, when.isoformat(timespec="seconds"), location or "")
                    if key in existing_keys:
                        continue
                    existing_keys.add(key)
                    ev = self.add_event(
                        title=title,
                        date_time=when.isoformat(timespec="seconds"),
                        location=location,
                        course=parsed["course"],
                    )
                    added.append(ev)

        if not added and skipped:
            return {
                "ok": False,
                "error": (
                    "No timetable entries could be parsed. Expected lines like "
                    "'CS302 Mon/Wed 10 AM in LT-5' or "
                    "'Mon 09:00 CS-302 Distributed Systems @ LT-5'."
                ),
                "skipped": skipped[:10],
            }
        self._save()
        return {
            "ok": True,
            "added_count": len(added),
            "added": added[:40],
            "skipped": skipped[:10],
            "duplicates_skipped": len(segments) - len(added) - len(skipped),
        }

    def upcoming(self, limit: int = 8) -> List[Dict[str, Any]]:
        now = datetime.now().isoformat(timespec="seconds")
        upcoming = [e for e in self.events if e.get("date", "") >= now]
        upcoming.sort(key=lambda e: e.get("date", ""))
        return upcoming[:limit]

    def state(self, limit: int = 8) -> List[Dict[str, Any]]:
        return self.upcoming(limit)
