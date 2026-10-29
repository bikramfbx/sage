import logging

from fastapi import APIRouter, HTTPException

from app.schemas.perceive import PerceiveOutcome, PerceiveRequest
from app.services.sage_brain import sage_brain
from skills import screen_perception as sp
from skills.rag_reader import sanitize_pdf_text

logger = logging.getLogger("sage")

router = APIRouter()


def _outcome(outcome: dict, matched: list) -> PerceiveOutcome:
    state = sage_brain.build_state()
    kind = outcome.get("type")
    if kind == "assignment":
        return PerceiveOutcome(
            status="assignment_scheduled",
            matched_keywords=matched,
            event=outcome.get("event"),
            source=outcome.get("source"),
            state=state,
        )
    if kind == "note":
        return PerceiveOutcome(
            status="note_saved",
            matched_keywords=matched,
            note=outcome.get("note"),
            source=outcome.get("source"),
            state=state,
        )
    return PerceiveOutcome(
        status="ignored", reason=outcome.get("reason"), matched_keywords=matched
    )


@router.post("/perceive", response_model=PerceiveOutcome)
async def perceive(request: PerceiveRequest):
    try:
        text = sp.run_ocr(request.image_base64)
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
        matched = sp.should_process(redacted, request.trigger_mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    if matched is None:
        return PerceiveOutcome(status="ignored", reason="no_keywords_matched")

    safe_text = sanitize_pdf_text(redacted, limit=4000)
    outcome = await sage_brain.screen_copilot.analyze(
        safe_text, request.subject_tag, matched
    )
    return _outcome(outcome, matched)
