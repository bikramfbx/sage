import logging
from typing import List, Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, HTTPException, Request

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.sage_brain import sage_brain

logger = logging.getLogger("sage")

router = APIRouter()


def _client_tz(request) -> str:
    """X-User-Timezone from the browser (fallback UTC), validated."""
    raw = (request.headers.get("X-User-Timezone") or "").strip()[:64]
    if raw:
        try:
            ZoneInfo(raw)
            return raw
        except (ZoneInfoNotFoundError, ValueError):
            pass
    return "UTC"


@router.post("/chat", response_model=ChatResponse)
async def chat(body: ChatRequest, request: Request):
    thread: List[dict] = [m.model_dump() for m in body.messages] if body.messages else []
    if not thread and body.message:
        thread = [{"role": "user", "content": body.message}]
    if not thread:
        raise HTTPException(status_code=400, detail="Provide a 'messages' array or 'message'.")
    try:
        return await sage_brain.process(
            thread,
            body.conversation_id,
            user_timezone=_client_tz(request),
            api_key_override=getattr(request.state, "nebius_override", None),
        )
    except Exception:
        # sanitized: log full trace server-side only, generic detail out
        logger.exception("Chat processing failed")
        raise HTTPException(status_code=500, detail="Internal server error")
