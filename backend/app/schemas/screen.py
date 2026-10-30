from typing import Optional

from pydantic import BaseModel, Field


class ScreenAnalyzeRequest(BaseModel):
    # base64 JPEG frame from the live tab stream; decoded in memory only
    # and never persisted as an image
    frame_base64: str = Field(min_length=16, max_length=8_000_000)
    question: Optional[str] = Field(default=None, max_length=2000)


class ScreenAnalyzeOutcome(BaseModel):
    status: str
    reply: Optional[str] = None
    log_line: Optional[str] = None
    summary: Optional[str] = None
    course_code: Optional[str] = None
    topic_title: Optional[str] = None
    due_date: Optional[str] = None
    event: Optional[dict] = None
    note_path: Optional[str] = None
    indexed: Optional[bool] = None
    state: Optional[dict] = None
