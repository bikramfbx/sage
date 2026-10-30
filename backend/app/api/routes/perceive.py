import asyncio
import logging

from fastapi import APIRouter, HTTPException, Request

from app.core.config import settings
from app.schemas.perceive import PerceiveOutcome, PerceiveRequest, PerceiveUploadOutcome
from app.services.macros_manager import MacrosManager
from app.services.sage_brain import sage_brain
from app.services.vision_copilot import vision_copilot
from skills import screen_perception as sp
from skills.rag_reader import sanitize_pdf_text
from skills.sandbox_guard import assert_in_sandbox

logger = logging.getLogger("sage")

router = APIRouter()
macros_manager = MacrosManager(sage_brain.tracker)


def _outcome(outcome: dict, matched: list) -> PerceiveOutcome:
    state = sage_brain.build_state()
    log_line = {
        "assignment": outcome.get("log_line"),
        "note": outcome.get("log_line"),
    }.get(outcome.get("type"))

    # persist the perception log bubble so it survives page refreshes via
    # GET /api/history (assignment/note outcomes only)
    if log_line:
        sage_brain.memory.append("assistant", log_line)

    kind = outcome.get("type")
    if kind == "assignment":
        return PerceiveOutcome(
            status="assignment_scheduled",
            matched_keywords=matched,
            event=outcome.get("event"),
            source=outcome.get("source"),
            log_line=log_line,
            state=state,
        )
    if kind == "note":
        return PerceiveOutcome(
            status="note_saved",
            matched_keywords=matched,
            note=outcome.get("note"),
            source=outcome.get("source"),
            log_line=log_line,
            state=state,
        )
    return PerceiveOutcome(
        status="ignored", reason=outcome.get("reason"), matched_keywords=matched
    )


async def _perceive_json(request: Request) -> PerceiveOutcome:
    try:
        body = await request.json()
        req = PerceiveRequest.model_validate(body)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="invalid JSON body")

    try:
        text = sp.run_ocr(req.image_base64)
    except sp.OcrUnavailable as exc:
        raise HTTPException(status_code=400, detail=f"Local OCR unavailable: {exc}")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception:
        logger.exception("Perception OCR failed")
        raise HTTPException(status_code=500, detail="Internal server error")

    redacted = sp.redact(text)
    if len(redacted.strip()) < 3:
        return PerceiveOutcome(status="ignored", reason="no_text_detected")

    try:
        matched = sp.should_process(redacted, req.trigger_mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if matched is None:
        return PerceiveOutcome(status="ignored", reason="no_keywords_matched")

    safe_text = sanitize_pdf_text(redacted, limit=4000)
    outcome = await sage_brain.screen_copilot.analyze(
        safe_text, req.subject_tag, matched
    )
    return _outcome(outcome, matched)


def _form_str(form, key: str, default: str = "") -> str:
    value = form.get(key)
    return str(value).strip() if value is not None else default


async def _perceive_upload(request: Request) -> PerceiveUploadOutcome:
    try:
        form = await request.form()
    except Exception:
        raise HTTPException(status_code=400, detail="invalid multipart form")

    upload = form.get("image")
    # form() returns either str (plain field) or an UploadFile-like object;
    # duck-typing because UploadFile classes differ across FastAPI builds
    if upload is None or isinstance(upload, str) or not hasattr(upload, "read"):
        raise HTTPException(status_code=400, detail="image file field is required")

    cap = settings.max_image_upload_mb * 1024 * 1024
    image_bytes = await upload.read(cap + 1)
    if len(image_bytes) < 16:
        raise HTTPException(status_code=400, detail="image file is empty or too small")
    if len(image_bytes) > cap:
        raise HTTPException(
            status_code=413,
            detail=f"image exceeds the {settings.max_image_upload_mb} MB upload cap",
        )
    try:
        sp.validate_image_bytes(image_bytes)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    prompt_text = _form_str(form, "prompt")[: settings.max_message_chars]
    subject_tag = _form_str(form, "subject_tag")[:64] or None

    verdict = await vision_copilot.classify(image_bytes)
    category = verdict["category"]

    if category == sp.FOOD_MEAL:
        return await _process_food(image_bytes, prompt_text, verdict["source"])
    return await _process_assignment(image_bytes, prompt_text, subject_tag, verdict["source"])


def _remember(prompt_text: str, assistant_text: str) -> None:
    """Persist the perception exchange so it survives refreshes.

    Both turns go into the persistent chat history: the user message
    (prompt text, or the same 'Analyze this image' fallback the frontend
    bubble shows) and the full rich assistant markdown response.
    """
    sage_brain.memory.append("user", prompt_text or "Analyze this image")
    sage_brain.memory.append("assistant", assistant_text)


async def _process_food(
    image_bytes: bytes, prompt_text: str, source: str
) -> PerceiveUploadOutcome:
    analysis = await vision_copilot.analyze_food(image_bytes)
    if analysis is None:
        # vision down: last-resort nutrition-label OCR parse
        try:
            ocr_text = await _ocr(image_bytes)
        except Exception:
            ocr_text = ""
        analysis = sp._nutrition_label_estimate(ocr_text) if ocr_text else None
    if analysis is None:
        return PerceiveUploadOutcome(
            status="error",
            type="FOOD_MEAL",
            reason="vision_unavailable",
            source=source,
        )

    totals = analysis["totals"]
    result = macros_manager.log_meal(
        label=analysis["summary"],
        calories=totals["calories"],
        protein=totals["protein"],
        carbs=totals.get("carbs"),
        fats=totals.get("fats"),
    )
    entry = result["entry"]
    today = result["today_totals"]
    targets = result["targets"]

    # rich markdown breakdown — passed verbatim into the assistant chat
    # bubble by the frontend (data.summary)
    headline = (
        "**Meal Already Tracked Today** 🥗"
        if result["duplicate"]
        else "**Meal Logged Successfully!** 🥗"
    )
    itemized = "\n".join(
        f"- **{item['name']}:** {item['calories']:.0f} kcal · "
        f"{item['protein_g']:.0f}g protein · {item['carbs_g']:.0f}g carbs · "
        f"{item['fats_g']:.0f}g fats"
        for item in analysis["items"]
    )
    summary = (
        f"{headline}\n\n"
        "**Estimated Macros:**\n"
        f"- **Calories:** {totals['calories']:.0f} kcal\n"
        f"- **Protein:** {totals['protein']:.0f}g\n"
        f"- **Carbs:** {totals['carbs']:.0f}g\n"
        f"- **Fats:** {totals['fats']:.0f}g\n\n"
        f"{itemized}\n\n"
        "*Updated today's totals in your Macro Tracker.*"
    )

    prefix = "Already tracked: " if result["duplicate"] else "Vision perception: logged "
    log_line = (
        f"{prefix}{analysis['summary']} — ~{totals['calories']:.0f} kcal / "
        f"{totals['protein']:.0f} g protein. Daily Total: "
        f"{today['calories']:.0f} / {targets['calories']:.0f} kcal, "
        f"{today['protein']:.0f} / {targets['protein']:.0f} g protein."
    )
    _remember(prompt_text, summary)
    return PerceiveUploadOutcome(
        status="food_logged",
        type="FOOD_MEAL",
        summary=summary,
        reply=summary,
        macros={
            "items": analysis["items"],
            "entry": entry,
            "today_totals": today,
            "targets": targets,
        },
        source=analysis.get("source", source),
        log_line=log_line,
        state=sage_brain.build_state(),
    )


async def _ocr(image_bytes: bytes) -> str:
    return await asyncio.to_thread(sp.run_ocr_bytes, image_bytes)


async def _process_assignment(
    image_bytes: bytes, prompt_text: str, subject_tag: str | None, source: str
) -> PerceiveUploadOutcome:
    analysis = await vision_copilot.analyze_assignment(image_bytes)
    text = sp.redact(str(analysis.get("text") or ""))
    course = analysis.get("course")
    title = str(analysis.get("title") or "").strip() or sp._guess_first_line(text)

    due_raw = analysis.get("due_date")
    due_date = sp.parse_due_date(due_raw) or sp.parse_due_date(text)

    event = None
    if due_date:
        try:
            event = sage_brain.schedule.add_event(
                title=title or "Assignment (from image)",
                date_time=due_date,
                location=None,
                course=course,
            )
        except ValueError:
            logger.warning("Assignment due date could not be scheduled: %s", due_date)

    markdown = sp.build_assignment_markdown(
        course=course,
        title=title,
        due_date=due_date,
        text=text,
        source=source,
    )
    if subject_tag:
        markdown = f"- Subject tag: {subject_tag}\n" + markdown

    note_path = sage_brain.sandbox_dir / sp.default_note_path()
    try:
        note_path = assert_in_sandbox(note_path)
        note_path.write_text(markdown, encoding="utf-8")
        indexed = True
    except Exception:
        logger.exception("Failed to persist assignment note")
        indexed = False

    # trigger rag_reader to re-index sandbox/docs so the new note is
    # immediately searchable in chat
    sage_brain.reader.invalidate()

    when = f" — due {due_date[:16].replace('T', ' ')}" if due_date else ""
    dup = " (already on your schedule)" if event and event.get("duplicate") else ""
    log_line = (
        f"Vision perception: saved \"{title or 'assignment capture'}\""
        f"{f' ({course})' if course else ''}{when}{dup} — indexed into your notes"
    )

    # rich markdown breakdown for the chat bubble and persistent history
    detail_lines = [
        f"- **Course:** {course or 'unknown'}",
        f"- **Title:** {title or 'untitled'}",
    ]
    if due_date:
        state_note = " (already on your schedule)" if event and event.get("duplicate") else " (scheduled)"
        detail_lines.append(f"- **Due:** {due_date[:16].replace('T', ' ')}{state_note}")
    else:
        detail_lines.append("- **Due:** not stated — add it manually if needed")
    captured = [f"- {ln.strip()}" for ln in text.splitlines() if ln.strip()][:8]
    summary = (
        "**Assignment Captured & Indexed!** 📚\n\n"
        "**Details:**\n" + "\n".join(detail_lines) + "\n\n"
        + ("**Content captured:**\n" + "\n".join(captured) + "\n\n" if captured else "")
        + f"*Saved to `{note_path.name}` — searchable in chat via your notes library.*"
    )
    _remember(prompt_text, summary)
    return PerceiveUploadOutcome(
        status="assignment_saved",
        type="ACADEMIC_ASSIGNMENT",
        summary=summary,
        reply=summary,
        title=title,
        due_date=due_date,
        indexed=indexed,
        event=event,
        note_path=f"sandbox/{note_path.relative_to(sage_brain.sandbox_dir)}",
        source=analysis.get("source", source),
        log_line=log_line,
        state=sage_brain.build_state(),
    )


@router.post("/perceive")
async def perceive(request: Request):
    """Perception endpoint with two payload modes:

    - multipart/form-data: image file upload -> vision router -> FOOD_MEAL
      macro pipeline or ACADEMIC_ASSIGNMENT study pipeline
    - application/json: legacy base64 screen-capture flow (unchanged)
    """
    content_type = request.headers.get("content-type", "")
    if "multipart/form-data" in content_type:
        return await _perceive_upload(request)
    return await _perceive_json(request)
