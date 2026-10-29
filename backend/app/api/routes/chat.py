import logging
from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.sage_brain import sage_brain

logger = logging.getLogger("sage")

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    thread: List[dict] = [m.model_dump() for m in request.messages] if request.messages else []
    if not thread and request.message:
        thread = [{"role": "user", "content": request.message}]
    if not thread:
        raise HTTPException(status_code=400, detail="Provide a 'messages' array or 'message'.")
    try:
        return await sage_brain.process(thread, request.conversation_id)
    except Exception:
        # sanitized: log full trace server-side only, generic detail out
        logger.exception("Chat processing failed")
        raise HTTPException(status_code=500, detail="Internal server error")
