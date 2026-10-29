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
    state: Optional[AgentState] = None
