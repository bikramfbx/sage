from fastapi import APIRouter, HTTPException

from app.schemas.chat import AgentState
from app.services.sage_brain import sage_brain

router = APIRouter()


@router.get("/state", response_model=AgentState)
async def current_state():
    return sage_brain.build_state()


@router.delete("/schedule/{event_id}")
async def delete_schedule_event(event_id: str):
    removed = sage_brain.schedule.remove_event(event_id)
    if removed is None:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"deleted": True, "event": removed, "state": sage_brain.build_state()}
