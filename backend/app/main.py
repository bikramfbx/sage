import logging

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import chat, health, history, perceive, state
from app.core.config import settings

logger = logging.getLogger("sage")

app = FastAPI(
    title="SAGE API",
    description="Student Assistant for Growth and Education - Backend Bridge",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router, tags=["health"])
app.include_router(chat.router, prefix="/api", tags=["chat"])
app.include_router(state.router, prefix="/api", tags=["state"])
app.include_router(history.router, prefix="/api", tags=["history"])
app.include_router(perceive.router, prefix="/api", tags=["perception"])


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    """Sanitized safety net: log the stack trace server-side only, expose
    a generic message. Never leaks env vars, API keys, or tracebacks."""
    logger.exception("Unhandled error on %s %s", request.method, request.url.path)
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    # hide not-yet-sanitized internal details on 5xx; keep 4xx detail
    detail = exc.detail if exc.status_code < 500 else "Internal server error"
    if exc.status_code >= 500:
        logger.error("HTTPException %s on %s: %s", exc.status_code, request.url.path, exc.detail)
    return JSONResponse(status_code=exc.status_code, content={"detail": detail})


@app.get("/")
async def root():
    return {"message": "SAGE Backend Bridge", "docs": "/docs"}
