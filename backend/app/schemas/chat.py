from typing import List, Literal, Optional

from pydantic import BaseModel


class ChatMessage(BaseModel):
    role: Literal["user", "assistant", "system"]
    content: str


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


class ChatRequest(BaseModel):
    messages: Optional[List[ChatMessage]] = None
    message: Optional[str] = None
    conversation_id: Optional[str] = None


class ChatResponse(BaseModel):
    reply: str
    conversation_id: Optional[str] = None
    state: AgentState
