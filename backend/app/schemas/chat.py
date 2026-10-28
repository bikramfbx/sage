from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class ChatMessage(BaseModel):
    role: str
    content: str
    metadata: Optional[Dict[str, Any]] = None


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    context: Optional[Dict[str, Any]] = None
    stream: bool = False


class ChatResponse(BaseModel):
    response: str
    conversation_id: Optional[str] = None
    sources: Optional[List[Dict[str, Any]]] = None
    metadata: Optional[Dict[str, Any]] = None
