#!/usr/bin/env bash
# SAGE launcher — starts the FastAPI backend and Next.js dashboard as
# fully detached daemons (setsid fork) that survive OpenCode/shell exit.
#
# Usage:
#   bash start_servers.sh              # idempotent: skips already-running parts
#   npm run dev                        # same thing via root package.json
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGS="$ROOT/logs"
VENV="$ROOT/venv/bin"
mkdir -p "$LOGS"

PORT_BACKEND=8001
PORT_FRONTEND=3000
BACKEND_HOST="127.0.0.1"

pid_alive() {
  [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null
}

port_up() {
  curl -s -o /dev/null -m 2 "http://$1:$2$3"
}

# ---------------------------------------------------------------- backend --
if port_up "$BACKEND_HOST" "$PORT_BACKEND" /health || port_up "localhost" "$PORT_BACKEND" /health; then
  echo "[sage] backend already listening on $PORT_BACKEND"
else
  echo "[sage] starting backend (uvicorn $BACKEND_HOST:$PORT_BACKEND)"
  (
    cd "$ROOT/backend" &&
    exec setsid -f "$VENV/uvicorn" app.main:app --host "$BACKEND_HOST" --port "$PORT_BACKEND" \
      > "$LOGS/backend.log" 2>&1 < /dev/null
  )
fi

# wait for backend health
for _ in $(seq 1 20); do
  if port_up "$BACKEND_HOST" "$PORT_BACKEND" /health; then break; fi
  sleep 0.5
done
if port_up "$BACKEND_HOST" "$PORT_BACKEND" /health; then
  echo "[sage] backend healthy on $BACKEND_HOST:$PORT_BACKEND  (log: logs/backend.log)"
else
  echo "[sage] WARNING: backend health check failed — see logs/backend.log" >&2
fi

# --------------------------------------------------------------- frontend --
if port_up "localhost" "$PORT_FRONTEND" /; then
  echo "[sage] dashboard already listening on $PORT_FRONTEND"
else
  if [ ! -f "$ROOT/frontend/.next/BUILD_ID" ]; then
    echo "[sage] no production build found — building..."
    (cd "$ROOT/frontend" && npm run build > "$LOGS/frontend-build.log" 2>&1) ||
      { echo "[sage] build failed — see logs/frontend-build.log" >&2; exit 1; }
  fi
  echo "[sage] starting dashboard (next start :$PORT_FRONTEND)"
  (
    cd "$ROOT/frontend" &&
    exec setsid -f nohup npm start > "$LOGS/frontend.log" 2>&1 < /dev/null
  )
fi

for _ in $(seq 1 20); do
  if port_up "localhost" "$PORT_FRONTEND" /; then break; fi
  sleep 0.5
done
if port_up "localhost" "$PORT_FRONTEND" /; then
  echo "[sage] dashboard ready on http://localhost:$PORT_FRONTEND  (log: logs/frontend.log)"
else
  echo "[sage] WARNING: dashboard health check failed — see logs/frontend.log" >&2
fi

echo "[sage] done."
