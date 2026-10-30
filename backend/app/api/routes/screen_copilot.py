import asyncio
import logging
import re
from datetime import datetime, timedelta

from fastapi import APIRouter, HTTPException

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
    r"(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})",
    re.IGNORECASE,
)
_ISO_DUE = re.compile(r"\b(\d{4}-\d{2}-\d{2})(?:[T ](\d{1,2}:\d{2}))?\b")
_CODE_RE = re.compile(r"\b([A-Z]{2,4}-?\d{3}[A-Z]?)\b")


def _parse_due_date(raw) -> str | None:
    if raw is None:
        return None
    value = str(raw).strip()
    if not value or value.lower() in ("null", "none", "n/a", "na"):
        return None
    try:
        return parse_datetime(value).isoformat(timespec="seconds")
    except ValueError:
        pass
    iso = _ISO_DUE.search(value)
    if iso:
        candidate = iso.group(1) + (f"T{iso.group(2)}:00" if iso.group(2) else "T09:00:00")
        try:
            return parse_datetime(candidate).isoformat(timespec="seconds")
        except ValueError:
            pass
    month = _MONTH_DAY.search(value.lower())
    if month:
        today = datetime.now()
        try:
            candidate = datetime.strptime(
                f"{month.group(1)[:3]} {month.group(2)}", "%b %d"
            ).replace(year=today.year)
            if candidate < today - timedelta(days=1):
                candidate = candidate.replace(year=today.year + 1)
            return candidate.isoformat(timespec="seconds")
        except ValueError:
            return None
    return None


def _remember(prompt_text: str, assistant_text: str) -> None:
    """Persist the screen-copilot exchange so cross-questioning keeps
    working after reloads — earlier captures stay in chat history."""
    if prompt_text:
        sage_brain.memory.append("user", prompt_text)
    sage_brain.memory.append("assistant", assistant_text)


@router.post("/screen/analyze", response_model=ScreenAnalyzeOutcome)
async def screen_analyze(request: ScreenAnalyzeRequest):
    """Live Screen Copilot: analyze one captured tab frame, or answer a
    student question about the current screen (enriched with RAG)."""
    if not tab_analyzer.vision_available():
        raise HTTPException(status_code=503, detail="vision unavailable")
    try:
        if request.question:
            rag_hits = sage_brain.reader.search(request.question, top_k=3)
            rag_block = "\n".join(
                "- {doc}{page}: {snippet}".format(
                    doc=h["document"],
                    page=f" p{h['page']}" if h.get("page") else "",
                    snippet=h["snippet"],
                )
                for h in rag_hits
            ) or "(no local notes matched)"
            answer = await _ask(request.frame_base64, request.question, rag_block)
            return answer
        return await _analyze(request.frame_base64)
    except HTTPException:
        raise
    except RuntimeError as exc:
        raise HTTPException(status_code=503, detail=f"vision unavailable: {exc}")
    except Exception:
        logger.exception("Screen copilot analysis failed")
        raise HTTPException(status_code=500, detail="Internal server error")


async def _ask(frame_b64: str, question: str, rag_block: str) -> ScreenAnalyzeOutcome:
    prompt = ASK_PROMPT.format(question=question, rag_block=rag_block)
    tab_analyzer.llm_calls += 1
    raw = await asyncio.to_thread(
        _call_vlm, frame_b64, prompt, **tab_analyzer._creds(), system=ASK_SYSTEM
    )
    answer = extract_answer(raw)
    _remember(question, answer)
    return ScreenAnalyzeOutcome(
        status="answered",
        reply=answer,
        summary=answer,
        state=sage_brain.build_state(),
    )


async def _analyze(frame_b64: str) -> ScreenAnalyzeOutcome:
    result = await tab_analyzer.analyze_frame(frame_b64)
    course = result.get("course_code")
    topic = result.get("topic_title")
    raw_text = result.get("raw_text") or ""
    note_md = result.get("note_markdown") or ""
    due_date = _parse_due_date(result.get("due_date")) or _parse_due_date(raw_text)

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

    now = datetime.now()
    stamp = now.strftime("%Y%m%d_%H%M%S")
    lines = [
        f"# Screen capture — {topic or 'live tab'} — {now.strftime('%Y-%m-%d %H:%M')}",
        "",
        f"- Course: {course or 'unknown'}",
        f"- Due: {due_date or 'not stated'}",
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

    when = f", due {due_date[:16].replace('T', ' ')}" if due_date else ""
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
