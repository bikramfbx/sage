from fastapi import APIRouter

from app.services.sage_brain import sage_brain

router = APIRouter()


@router.get("/history")
async def get_history():
    return {"messages": sage_brain.memory.client_view()}


@router.delete("/history")
async def clear_history():
    sage_brain.memory.clear()
    return {"ok": True}
