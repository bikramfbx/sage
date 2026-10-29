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
- `POST /api/perceive` — Study Copilot: `{image_base64, trigger_mode:
  "auto_scan"|"manual_snap", subject_tag}`. Local OCR (pytesseract) +
  PII/secret redaction run on-device; the keyword gatekeeper drops
  non-study frames locally (`{"status": "ignored"}`, zero LLM calls).
  Study frames get one Nemotron call that either auto-schedules an
  assignment (via `schedule_manager`) or saves a structured Markdown
  note to `sandbox/docs/auto_notes_{timestamp}.md`. Frames live only in
  memory and are never written to disk. Requires the `tesseract` binary;
  degrades with an explicit `ocr_unavailable` error.

## Architecture notes

- Skills live at the repo root in `skills/` (`macro_tracker`,
  `rag_reader`, `schedule_manager`) and are imported by
  `app/services/sage_brain.py`.
- The agent loop, tool registry, and SAGE persona prompt are all in
  `sage_brain.py`; NVIDIA OpenShell / NemoClaw sandboxing wraps this
  process at the infrastructure layer.

## Security model

- Filesystem: all skill file I/O is resolved and checked for containment
  inside `sandbox/` (`skills/sandbox_guard.py`) — traversal and absolute
  escapes raise `ValueError` before any read/write.
- Prompt injection: extracted PDF text is sanitized (control chars
  stripped, angle brackets HTML-escaped) and LLM-facing tool results are
  wrapped in `<tool_results>` / `<document_context>` delimiters; the
  system prompt declares all such content untrusted. The agent loop is
  hard-capped at 5 rounds.
- API: CORS is a strict allowlist (`localhost:3000`, `127.0.0.1:3000`),
  all 5xx responses are generic, and stack traces / secrets stay in the
  server log only. Chat payloads are length-limited via Pydantic.
- Verify with `venv/bin/python scripts/security_checks.py`.
