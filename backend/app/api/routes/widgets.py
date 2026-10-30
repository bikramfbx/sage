from typing import Any, Dict

from fastapi import APIRouter, Body, HTTPException

from app.services import widgets_manager
from app.services.sage_brain import sage_brain

router = APIRouter()


@router.get("/widgets")
async def get_widgets():
    return {"widgets": widgets_manager.read()}


@router.post("/widgets/update")
async def update_widget(payload: Dict[str, Any] = Body(...)):
    try:
        validated = widgets_manager.validate(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    widget = widgets_manager.upsert(validated)
    return {
        "ok": True,
        "widget": widget,
        "widgets": widgets_manager.read(),
        "state": sage_brain.build_state(),
    }


@router.delete("/widgets/{widget_id}")
async def delete_widget(widget_id: str):
    removed = widgets_manager.delete(widget_id)
    return {
        "ok": removed,
        "widgets": widgets_manager.read(),
        "state": sage_brain.build_state(),
    }
