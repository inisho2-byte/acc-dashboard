#!/usr/bin/env bash
# ACC Dashboard — Local Development Startup Script
# Starts the FastAPI backend server (no Docker required).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== ACC Dashboard Local Startup ==="
echo "Project: $PROJECT_DIR"

# Check virtual environment
if [ -d ".venv" ]; then
    PYTHON=".venv/bin/python"
    UVICORN=".venv/bin/uvicorn"
elif [ -d "venv" ]; then
    PYTHON="venv/bin/python"
    UVICORN="venv/bin/uvicorn"
else
    echo "Warning: no virtual environment found. Using system Python."
    PYTHON="python3"
    UVICORN="uvicorn"
fi

echo "Python: $PYTHON"
echo "Uvicorn: $UVICORN"

# Verify Hermes API is reachable (warn if not)
if curl -s http://localhost:8642/health >/dev/null 2>&1; then
    echo "Hermes API: online (port 8642)"
else
    echo "Hermes API: not reachable on port 8642 (ARETE will show offline until started)"
fi

# Start the server
PORT=8643
HOST=127.0.0.1

echo ""
echo "Starting server on http://$HOST:$PORT"
echo "Press Ctrl+C to stop"
echo ""

exec "$UVICORN" server.main:app \
    --host "$HOST" \
    --port "$PORT" \
    --reload \
    --log-level info
