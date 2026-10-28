from fastapi import APIRouter, HTTPException
from app.schemas.chat import ChatRequest, ChatResponse
from app.services.hermes_bridge import hermes_bridge

router = APIRouter()


@router.post("/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    try:
        result = await hermes_bridge.chat(request.message, request.context)
        return ChatResponse(
            response=result.get("response", ""),
            conversation_id=request.conversation_id,
            sources=result.get("sources"),
            metadata=result.get("metadata"),
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
