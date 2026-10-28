from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

class ChatMessage(BaseModel):
    message: str

@app.post("/api/chat")
async def chat(req: ChatMessage):
    return {"reply": f"Mock AI Response to: {req.message}", "state": {"calories": 2100, "protein": 130, "next_event": "No upcoming deadlines"}}
