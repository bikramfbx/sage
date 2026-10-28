from fastapi import APIRouter

from app.schemas.chat import AgentState
from app.services.sage_brain import sage_brain

router = APIRouter()


@router.get("/state", response_model=AgentState)
async def current_state():
    return sage_brain.build_state()
