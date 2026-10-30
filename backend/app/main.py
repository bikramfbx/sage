import logging
import os
import time
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import chat, health, history, screen_copilot, state, summary, widgets
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
app.include_router(widgets.router, prefix="/api", tags=["widgets"])

# ---- LLM endpoint guard: judge auth + per-IP rate limit + session cap ----
# Gated endpoints burn API budget, so they require either the judge demo
# token or a client-supplied Nebius key (BYOK). Everything else stays open.
GATED_PATHS = ("/api/chat", "/api/screen/analyze")
IP_LIMIT = 10          # requests / minute / IP across gated endpoints
IP_WINDOW_SECONDS = 60.0
JUDGE_TOKEN = os.getenv("JUDGE_DEMO_TOKEN", settings.judge_demo_token)
SESSION_CAP = int(os.getenv("JUDGE_SESSION_CAP", str(settings.judge_session_cap)))
_llm_ip_buckets: dict = defaultdict(deque)
_session_counts: dict = defaultdict(int)


@app.middleware("http")
async def llm_guard_middleware(request: Request, call_next):
    path = request.url.path
    gated = any(path == p or path.startswith(p + "/") for p in GATED_PATHS)
    if not gated:
        return await call_next(request)

    judge_token = (request.headers.get("X-Judge-Token") or "").strip()
    byok_key = (request.headers.get("X-Nebius-Api-Key") or "").strip()

    if judge_token == JUDGE_TOKEN:
        # judge session: server-side NEBIUS_API_KEY (env-backed), capped
        if _session_counts[judge_token] >= SESSION_CAP:
            logger.warning("Judge session cap reached (%s)", request.client.host if request.client else "?")
            return JSONResponse(
                status_code=429,
                content={"detail": "Session query limit reached for demo."},
            )
        _session_counts[judge_token] += 1
        request.state.nebius_override = None
    elif byok_key:
        # personal key: client pays, no session cap
        request.state.nebius_override = byok_key
    else:
        return JSONResponse(
            status_code=401,
            content={
                "detail": (
                    "Unauthorized — provide a judge token (X-Judge-Token) or your "
                    "Nebius API key (X-Nebius-Api-Key)."
                )
            },
        )

    ip = request.client.host if request.client else "unknown"
    bucket = _llm_ip_buckets[ip]
    now = time.time()
    while bucket and now - bucket[0] > IP_WINDOW_SECONDS:
        bucket.popleft()
    if len(bucket) >= IP_LIMIT:
        logger.warning("IP rate limit reached for %s on %s", ip, path)
        return JSONResponse(
            status_code=429,
            content={"detail": "Too many requests — rate limit is 10 per minute."},
        )
    bucket.append(now)
    return await call_next(request)
app.include_router(screen_copilot.router, prefix="/api", tags=["screen copilot"])
app.include_router(widgets.router, prefix="/api", tags=["widgets"])


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
