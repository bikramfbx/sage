"""Daily study & macro progress summarizer for SAGE.

Gathers today's macro metrics (sandbox/state/macros.json) and near-term
academic items (sandbox/state/schedule.json, next 48-72h), then produces
a 3-bullet executive briefing: macro status, academic priorities, and an
actionable recommendation. The LLM composes the wording when available;
a deterministic template covers offline mode so the endpoint always
returns a complete briefing.
"""

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional

SUMMARY_SYSTEM_PROMPT = """You write a 3-bullet executive daily briefing for a university student, combining nutrition and academics. You are warm but concise. Each bullet must be ONE short sentence (under 140 characters). Reply with PURE JSON only, no markdown fences:
{"macro": "...", "academic": "...", "action": "..."}
Rules: use the provided numbers exactly; academic bullet names concrete items and their dates; the action bullet must be specific and time-anchored (e.g. "Log dinner and hit ~50g more protein during your evening study block"). No trailing text after the JSON."""


def gather(
    tracker,
    schedule,
    hours_lookahead: int = 72,
) -> Dict[str, Any]:
    """Collect macro + schedule data for the briefing."""
    macro_state = tracker.state()
    totals = macro_state["totals"]
    targets = tracker.targets

    now = datetime.now()
    cutoff = (now + timedelta(hours=hours_lookahead)).isoformat(timespec="seconds")
    near = [
        e for e in schedule.upcoming(40) if e.get("date", "") <= cutoff
    ]

    return {
        "date": now.strftime("%A, %B %d, %Y"),
        "time": now.strftime("%H:%M"),
        "macros": {
            "totals": totals,
            "targets": targets,
            "entries": macro_state["entries"],
            "calories_pct": round(
                totals["calories"] / targets["calories"] * 100, 1
            ) if targets["calories"] else 0,
            "protein_pct": round(
                totals["protein"] / targets["protein"] * 100, 1
            ) if targets["protein"] else 0,
        },
        "upcoming_next_72h": near,
    }


def compose_prompt(data: Dict[str, Any]) -> str:
    macros = data["macros"]
    near = data["upcoming_next_72h"]
    event_lines = "\n".join(
        f"- {e['date'][:16].replace('T', ' ')} — {e['title']}"
        + (f" ({e['location']})" if e.get("location") else "")
        for e in near
    ) or "(nothing scheduled in the next 72 hours)"
    meals = "\n".join(
        f"- {e['time'][11:16]} · {e['label']} — {e['calories']:.0f} kcal, {e['protein']:.0f} g protein"
        for e in macros["entries"]
    ) or "(no meals logged yet)"
    return (
        f"Date: {data['date']}, local time {data['time']}.\n"
        f"Macros today: {macros['totals']['calories']:.0f} / {macros['targets']['calories']:.0f} kcal "
        f"({macros['calories_pct']}%), protein {macros['totals']['protein']:.0f} / "
        f"{macros['targets']['protein']:.0f} g ({macros['protein_pct']}%).\n"
        f"Logged meals:\n{meals}\n"
        f"Next 72 hours schedule:\n{event_lines}"
    )


def parse_briefing(content: Optional[str]) -> Optional[Dict[str, str]]:
    import json as _json
    import re as _re

    if not content:
        return None
    content = _re.sub(
        r"<\s*/?\s*(?:think|thinking)\s*>", "", content, flags=_re.IGNORECASE
    )
    try:
        parsed = _json.loads(content)
        if not isinstance(parsed, dict):
            raise ValueError
        return _validated(parsed)
    except (ValueError, _json.JSONDecodeError):
        pass

    # full-document parse failed (think-tags, fences, or truncated output):
    # extract each field independently; the closing quote is optional so a
    # token-truncated final field still yields its text
    repaired = {}
    for key in ("macro", "academic", "action"):
        m = _re.search(rf'"{key}"\s*:\s*"((?:[^"\\]|\\.)*)', content, _re.DOTALL)
        if m:
            try:
                repaired[key] = _json.loads(f'"{m.group(1)}"')
            except _json.JSONDecodeError:
                repaired[key] = m.group(1)
    if len(repaired) == 3:
        return _validated(repaired)
    return None


def _validated(candidate: Dict[str, Any]) -> Optional[Dict[str, str]]:
    out = {}
    for key in ("macro", "academic", "action"):
        value = candidate.get(key)
        if not isinstance(value, str) or not value.strip():
            return None
        out[key] = value.strip()[:300]
    return out


def offline_briefing(data: Dict[str, Any]) -> Dict[str, str]:
    macros = data["macros"]
    near = data["upcoming_next_72h"]
    macro_line = (
        f"Protein: {macros['totals']['protein']:.0f} g / {macros['targets']['protein']:.0f} g "
        f"({macros['protein_pct']}%), calories {macros['totals']['calories']:.0f} / "
        f"{macros['targets']['calories']:.0f} kcal ({macros['calories_pct']}%)."
    )
    if near:
        first = near[0]
        names = ", ".join(e["title"] for e in near[:3] if e.get("title"))
        academic = (
            f"{first['title']} lands {first['date'][:10]}"
            + (f" at {first['date'][11:16]}" if len(first.get("date", "")) > 11 else "")
            + f"; queue also has {names}."
        )
        action = f"Block time before {first['date'][:10]} for {first['title']} and close the macro gap at dinner."
    else:
        academic = "Nothing due in the next 72 hours — clear runway for deep work."
        action = "Use the open window for an extra study block and a protein-top-up meal."

    return {"macro": macro_line, "academic": academic, "action": action}
