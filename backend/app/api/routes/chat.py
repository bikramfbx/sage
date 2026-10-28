from typing import List, Optional

from fastapi import APIRouter, HTTPException

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.sage_brain import sage_brain

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    thread: List[dict] = list(request.messages) if request.messages else []
    if not thread and request.message:
        thread = [{"role": "user", "content": request.message}]
    if not thread:
        raise HTTPException(status_code=400, detail="Provide a 'messages' array or 'message'.")
    try:
        return await sage_brain.process(
            [m if isinstance(m, dict) else m.model_dump() for m in thread],
            request.conversation_id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
