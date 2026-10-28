from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes import health, chat

app = FastAPI(
    title="SAGE API",
    description="Student Assistant for Growth and Education - Backend Bridge",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(chat.router, prefix="/api", tags=["chat"])


@app.get("/")
async def root():
    return {"message": "SAGE Backend Bridge", "docs": "/docs"}
