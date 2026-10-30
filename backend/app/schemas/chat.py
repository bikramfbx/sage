from typing import List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

from app.core.config import settings


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=settings.max_message_chars)


class MacroEntry(BaseModel):
    label: str
    calories: float
    protein: float
    time: str


class MacroTotals(BaseModel):
    calories: float
    protein: float


class MacroTargets(BaseModel):
    calories: float
    protein: float


class MacrosState(BaseModel):
    date: str
    totals: MacroTotals
    targets: MacroTargets
    entries: List[MacroEntry]


class ScheduleEvent(BaseModel):
    title: str
    date: str
    location: Optional[str] = None
    course: Optional[str] = None


class DocumentRef(BaseModel):
    document: str
    page: Optional[int] = None
    snippet: Optional[str] = None


class AgentState(BaseModel):
    macros: MacrosState
    schedule: List[ScheduleEvent]
    documents: List[DocumentRef]
    widgets: List[dict] = Field(default_factory=list)


class ChatRequest(BaseModel):
    messages: Optional[List[ChatMessage]] = Field(
        default=None, max_length=settings.max_chat_messages
    )
    message: Optional[str] = Field(
        default=None, max_length=settings.max_message_chars
    )
    conversation_id: Optional[str] = Field(default=None, max_length=64)

    @model_validator(mode="after")
    def require_input(self):
        has_messages = bool(self.messages)
        has_message = self.message is not None and self.message.strip() != ""
        if not has_messages and not has_message:
            raise ValueError("Provide a non-empty 'messages' array or 'message'.")
        return self


class ChatResponse(BaseModel):
    reply: str
    conversation_id: Optional[str] = None
    state: AgentState
