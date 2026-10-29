# SAGE Backend

Canonical FastAPI bridge for SAGE. Serves the Next.js dashboard and routes
chat input through the local skills in `skills/` (macro tracker, RAG PDF
reader) plus sandbox data in `sandbox/`.

## Setup

Run from the repo root venv, with `backend/` as the working directory
(so `../.env` and repo-root `skills/` resolve):

```bash
cd backend
../venv/bin/pip install -r requirements.txt
../venv/bin/uvicorn app.main:app --reload --port 8001
```

(The default port is 8001 — port 8000 is occupied by an unrelated local
service.)

The repo-root `.env` supplies `NEBIUS_API_KEY`, `NEBIUS_BASE_URL`, and
`MODEL_ID` for the Nebius inference bridge.

## Endpoints

- `GET /` — service info
- `GET /health` — health check
- `POST /api/chat` — main bridge: send the full conversation as
  `{messages: [{role, content}, ...]}` (a legacy single `message` field also
  works). SAGE runs Nemotron-3-Ultra on Nebius with native function calling
  (`log_macros`, `manage_schedule`, `search_docs`) and returns
  `{reply, state}` where `state` carries `macros`, `schedule`, and
  `documents` (RAG hits). Falls back to a deterministic offline mode if the
  LLM is unreachable.
- `GET /api/state` — current state snapshot (widgets use this on load)
- `GET /api/history` — persisted conversation turns for dashboard restore
- `DELETE /api/history` — wipe chat history + compressed summary (macros
  and schedule state are untouched)

## Architecture notes

- Skills live at the repo root in `skills/` (`macro_tracker`,
  `rag_reader`, `schedule_manager`) and are imported by
  `app/services/sage_brain.py`.
- The agent loop, tool registry, and SAGE persona prompt are all in
  `sage_brain.py`; NVIDIA OpenShell / NemoClaw sandboxing wraps this
  process at the infrastructure layer.
