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
`MODEL_ID` for the upcoming Nebius/Nemotron inference bridge.

## Endpoints

- `GET /` — service info
- `GET /health` — health check
- `POST /api/chat` — main bridge: `{message}` → `{reply, state}` where
  `state` carries `macros` (totals/targets/entries), `schedule` (upcoming
  events), and `documents` (RAG hits)
- `GET /api/state` — current state snapshot (widgets use this on load)


## Architecture notes

- Skills live at the repo root in `skills/` and are imported by
  `app/services/sage_brain.py`.
- Hermes Agent (NVIDIA OpenShell) / NemoClaw integration will slot into
  `sage_brain.process()` — reply composition is isolated there.
