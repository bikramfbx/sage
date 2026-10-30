import asyncio
import logging
import re
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException, Request

from app.schemas.screen import ScreenAnalyzeOutcome, ScreenAnalyzeRequest
from app.services.sage_brain import sage_brain
from app.services.tab_analyzer import (
    ASK_PROMPT,
    ASK_SYSTEM,
    _call_vlm,
    extract_answer,
    tab_analyzer,
)
from skills.sandbox_guard import assert_in_sandbox
from skills.schedule_manager import parse_datetime

logger = logging.getLogger("sage")

router = APIRouter()

_MONTH_DAY = re.compile(
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})"
    r"(?:st|nd|rd|th)?(?:,)?\s*(\d{4})?",
    re.IGNORECASE,
)
_DMY = re.compile(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b")
_ISO_DUE = re.compile(r"\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2}))?\b")
_WEEKDAY = re.compile(
    r"\b(next|this|upcoming)?\s*(monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b",
    re.IGNORECASE,
)
_DAYS = {
    "monday": 0, "mon": 0,
    "tuesday": 1, "tue": 1, "tues": 1,
    "wednesday": 2, "wed": 2,
    "thursday": 3, "thu": 3, "thur": 3, "thurs": 3,
    "friday": 4, "fri": 4,
    "saturday": 5, "sat": 5,
    "sunday": 6, "sun": 6,
}
_CODE_RE = re.compile(r"\b([A-Z]{2,4}-?\d{3}[A-Z]?)\b")
_DATE_LIKE = re.compile(
    r"\b(?:due|deadline|submit(?:ted)? by|last date)\b[^\n]{0,50}|"
    r"\b\d{1,2}/\d{1,2}/\d{2,4}\b|"
    r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b|"
    r"\b(?:next|this|upcoming)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b",
    re.IGNORECASE,
)


def _date_like(text: str) -> str | None:
    """First date-ish fragment in extracted text, for display fallback."""
    match = _DATE_LIKE.search(text or "")
    return match.group(0).strip()[:80] if match else None


_TIME = re.compile(r"\b(\d{1,2}):(\d{2})\s*(am|pm)\b", re.IGNORECASE)


def _attach_time(value: str, candidate: datetime) -> datetime:
    """Preserve an explicit 12h time ("11:59 PM") found in the text."""
    tm = _TIME.search(value or "")
    if tm:
        hour = int(tm.group(1)) % 12 + (12 if tm.group(3).lower() == "pm" else 0)
        try:
            return candidate.replace(hour=hour, minute=int(tm.group(2)))
        except ValueError:
            return candidate
    return candidate


def _relative_weekday(text: str) -> str | None:
    """'next Wednesday' / 'this Friday' / bare weekday -> ISO date."""
    match = _WEEKDAY.search(text.lower())
    if not match:
        return None
    target = _DAYS[match.group(2)[:3]] if match.group(2)[:3] in _DAYS else _DAYS[match.group(2)]
    today = datetime.now()
    delta = (target - today.weekday()) % 7
    if delta == 0:
        delta = 7
    candidate = (today + timedelta(days=delta)).replace(
        hour=23, minute=59, second=0, microsecond=0
    )
    return candidate.isoformat(timespec="seconds")


def _parse_due_date(raw) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value or value.lower() in ("null", "none", "n/a", "na"):
        return None
    # 1) ISO 8601 / library-parsed formats
    try:
        return parse_datetime(value).isoformat(timespec="seconds")
    except ValueError:
        pass
    # 2) embedded ISO date
    iso = _ISO_DUE.search(value)
    if iso:
        candidate = iso.group(1) + (f"T{iso.group(2)}:00" if iso.group(2) else "T09:00:00")
        try:
            return parse_datetime(candidate).isoformat(timespec="seconds")
        except ValueError:
            pass
    # 3) numeric D/M/Y or M/D/Y — day-first first (Indian academic locale);
    #    fall back to month-first only when day > 12 makes day-first invalid
    dmy = _DMY.search(value)
    if dmy:
        day, month, year = int(dmy.group(1)), int(dmy.group(2)), int(dmy.group(3))
        if year < 100:
            year += 2000
        if 1 <= day <= 31 and 1 <= month <= 12:
            try:
                return _attach_time(
                    value,
                    datetime.strptime(f"{year:04d}-{month:02d}-{day:02d}", "%Y-%m-%d"),
                ).isoformat(timespec="seconds")
            except ValueError:
                pass
    # 4) month-name dates ("Nov 18, 2026", "November 18", "18 November")
    month = _MONTH_DAY.search(value)
    if month:
        year = int(month.group(3)) if month.group(3) else None
        today = datetime.now()
        try:
            candidate = datetime.strptime(
                f"{month.group(1)[:3]} {month.group(2)}", "%b %d"
            ).replace(year=year or today.year)
            if year is None and candidate < today - timedelta(days=1):
                candidate = candidate.replace(year=today.year + 1)
            return _attach_time(value, candidate).isoformat(timespec="seconds")
        except ValueError:
            pass
    # 5) relative weekdays ("Next Wednesday", "this Friday")
    return _relative_weekday(value)


def _due_display(due_date: str | None, due_raw) -> str | None:
    """Never render 'Due: not stated' when some date string exists on
    screen — fall back to the raw detected string if parsing failed."""
    if due_date:
        return due_date[:16].replace("T", " ")
    raw = str(due_raw or "").strip()
    if raw and raw.lower() not in ("null", "none", "n/a", "na"):
        return raw[:80]
    return None


def _remember(prompt_text: str, assistant_text: str) -> None:
    """Persist the screen-copilot exchange so cross-questioning keeps
    working after reloads — earlier captures stay in chat history."""
    if prompt_text:
        sage_brain.memory.append("user", prompt_text)
    sage_brain.memory.append("assistant", assistant_text)


@router.post("/screen/analyze", response_model=ScreenAnalyzeOutcome)
async def screen_analyze(request: Request, body: ScreenAnalyzeRequest):
    """Live Screen Copilot: analyze one captured tab frame, or answer a
    student question about the current screen (enriched with RAG)."""
    raw_tz = (request.headers.get("X-User-Timezone") or "").strip()[:64]
    tzinfo = None
    if raw_tz:
        try:
            tzinfo = ZoneInfo(raw_tz)
        except (ZoneInfoNotFoundError, ValueError):
            tzinfo = None
    if not tab_analyzer.vision_available():
        raise HTTPException(status_code=503, detail="vision unavailable")
    try:
        if body.question:
            rag_hits = sage_brain.reader.search(body.question, top_k=3)
            rag_block = "\n".join(
                "- {doc}{page}: {snippet}".format(
                    doc=h["document"],
                    page=f" p{h['page']}" if h.get("page") else "",
                    snippet=h["snippet"],
                )
                for h in rag_hits
            ) or "(no local notes matched)"
            answer = await _ask(
                body.frame_base64,
                body.question,
                rag_block,
                getattr(request.state, "nebius_override", None),
            )
            return answer
        return await _analyze(
            body.frame_base64,
            tzinfo,
            getattr(request.state, "nebius_override", None),
        )
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=f"vision unavailable: {exc}")
    except Exception:
        logger.exception("Screen copilot analysis failed")
        raise HTTPException(status_code=500, detail="Internal server error")


async def _ask(
    frame_b64: str,
    question: str,
    rag_block: str,
    api_key_override: Optional[str] = None,
) -> ScreenAnalyzeOutcome:
    prompt = ASK_PROMPT.format(question=question, rag_block=rag_block)
    tab_analyzer.llm_calls += 1
    raw = await asyncio.to_thread(
        _call_vlm, frame_b64, prompt, **tab_analyzer._creds(api_key_override), system=ASK_SYSTEM
    )
    answer = extract_answer(raw)
    _remember(question, answer)
    return ScreenAnalyzeOutcome(
        status="answered",
        reply=answer,
        summary=answer,
        state=sage_brain.build_state(),
    )


async def _analyze(
    frame_b64: str, tzinfo=None, api_key_override: Optional[str] = None
) -> ScreenAnalyzeOutcome:
    result = await tab_analyzer.analyze_frame(frame_b64, tzinfo, api_key_override)
    course = result.get("course_code")
    topic = result.get("topic_title")
    raw_text = result.get("raw_text") or ""
    note_md = result.get("note_markdown") or ""
    due_raw = result.get("due_date")
    due_date = _parse_due_date(due_raw) or _parse_due_date(raw_text)
    # never write "Due: not stated" when some date string exists on screen —
    # fall back to the raw detected string (VLM field or any date-like line)
    due_label = _due_display(due_date, due_raw) or _due_display(None, _date_like(raw_text))

    event = None
    if due_date:
        try:
            event = sage_brain.schedule.add_event(
                title=topic or "Assignment (from screen)",
                date_time=due_date,
                location=None,
                course=course,
            )
        except ValueError:
            logger.warning("Screen due date could not be scheduled: %s", due_date)

    now = datetime.now(tzinfo) if tzinfo else datetime.now()
    stamp = now.strftime("%Y%m%d_%H%M%S")
    lines = [
        f"# Screen capture — {topic or 'live tab'} — {now.strftime('%Y-%m-%d %H:%M')}",
        "",
        f"- Course: {course or 'unknown'}",
        f"- Due: {due_label}" if due_label else "- Due: not visible on screen",
        "- Source: live tab capture (frame not persisted)",
        "",
    ]
    if note_md.strip():
        lines += [note_md.strip(), ""]
    lines += ["## On-screen content", "", "```", raw_text.strip()[:4000], "```", ""]
    note_path = assert_in_sandbox(
        sage_brain.sandbox_dir / f"docs/auto_notes_screen_{stamp}.md"
    )
    note_path.write_text("\n".join(lines), encoding="utf-8")
    sage_brain.reader.invalidate()

    when = f", due {due_label}" if due_label else ""
    dup = " (already on your schedule)" if event and event.get("duplicate") else ""
    log_line = (
        f"Screen Copilot: indexed this tab{f' ({course})' if course else ''}"
        f"{when}{dup} — saved to {note_path.name} and searchable in chat"
    )
    summary = note_md.strip() or raw_text.strip()[:400] or "Screen capture indexed."
    _remember(None, log_line)
    return ScreenAnalyzeOutcome(
        status="indexed",
        log_line=log_line,
        summary=summary,
        course_code=course,
        topic_title=topic,
        due_date=due_date,
        event=event,
        note_path=f"sandbox/{note_path.relative_to(sage_brain.sandbox_dir)}",
        indexed=True,
        state=sage_brain.build_state(),
    )
