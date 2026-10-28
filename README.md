# SAGE - Student Assistant for Growth and Education

SAGE is an always-on, privacy-first personal AI designed for a university student.

## Architecture

- **Frontend**: Next.js 15 (App Router) web dashboard
- **Backend**: FastAPI bridge (runs natively, outside containerization for OpenShell/NemoClaw integration)
- **AI Orchestrator**: Hermes Agent (runs inside NVIDIA OpenShell sandbox)
- **Network Security**: NemoClaw
- **Inference**: Nebius Serverless with NVIDIA Nemotron-4-340b

## Development

See `docs/` for setup and architecture details.
