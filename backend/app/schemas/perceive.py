from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from app.core.config import settings
from app.schemas.chat import AgentState


class PerceiveRequest(BaseModel):
    # base64 frame (~5.8 MB binary at this cap); decoded in memory only and
    # never persisted to disk as an image
    image_base64: str = Field(min_length=16, max_length=8_000_000)
    trigger_mode: Literal["auto_scan", "manual_snap"]
    subject_tag: Optional[str] = Field(default=None, max_length=64)


class PerceiveOutcome(BaseModel):
    status: str
    reason: Optional[str] = None
    matched_keywords: Optional[List[str]] = None
    event: Optional[dict] = None
    note: Optional[dict] = None
    source: Optional[str] = None
    log_line: Optional[str] = None
    state: Optional[AgentState] = None


class PerceiveUploadOutcome(BaseModel):
    """Response for multipart image uploads (vision perception pipeline).

    FOOD_MEAL          -> status food_logged, summary + macros payload
    ACADEMIC_ASSIGNMENT-> status assignment_saved, title/due_date/indexed
    """

    status: Literal["food_logged", "assignment_saved", "ignored", "error"]
    type: Optional[Literal["FOOD_MEAL", "ACADEMIC_ASSIGNMENT"]] = None
    summary: Optional[str] = None
    reply: Optional[str] = None
    macros: Optional[dict] = None
    title: Optional[str] = None
    due_date: Optional[str] = None
    indexed: Optional[bool] = None
    event: Optional[dict] = None
    note_path: Optional[str] = None
    reason: Optional[str] = None
    source: Optional[str] = None
    log_line: Optional[str] = None
    state: Optional[AgentState] = None
