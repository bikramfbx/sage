from fastapi import APIRouter, HTTPException

from app.schemas.chat import ChatRequest, ChatResponse
from app.services.sage_brain import sage_brain

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        return sage_brain.process(request.message, request.conversation_id)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
