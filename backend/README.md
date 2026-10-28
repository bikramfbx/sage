# SAGE Backend

FastAPI bridge between the Next.js dashboard and Hermes Agent (OpenShell + NemoClaw).

## Setup

```bash
python -m venv venv
source venv/bin/activate  # or venv\Scripts\activate on Windows
pip install -r requirements.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Endpoints

- `GET /` - Root
- `GET /health` - Health check
- `POST /api/chat` - Main AI bridge endpoint
