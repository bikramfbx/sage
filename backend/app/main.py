import logging
import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import chat, health, history, screen_copilot, state, summary
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
app.include_router(summary.router, prefix="/api", tags=["summary"])
app.include_router(screen_copilot.router, prefix="/api", tags=["screen copilot"])

# Lightweight per-IP sliding-window limiter for the LLM-backed endpoints:
# keeps runaway clients (or loops) from burning API budget. In-memory only.
RATE_LIMITS = {"/api/chat": 30, "/api/screen/analyze": 20}
RATE_WINDOW_SECONDS = 60.0
_rate_buckets: dict = defaultdict(deque)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    path = request.url.path
    limit = next(
        (v for k, v in RATE_LIMITS.items() if path == k or path.startswith(k + "/")),
        None,
    )
    if limit is not None:
        ip = request.client.host if request.client else "unknown"
        key = f"{ip}|{path}"
        now = time.time()
        bucket = _rate_buckets[key]
        while bucket and now - bucket[0] > RATE_WINDOW_SECONDS:
            bucket.popleft()
        if len(bucket) >= limit:
            logger.warning("Rate limit reached for %s on %s", ip, path)
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests — slow down for a moment."},
            )
        bucket.append(now)
    return await call_next(request)
app.include_router(screen_copilot.router, prefix="/api", tags=["screen copilot"])


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
