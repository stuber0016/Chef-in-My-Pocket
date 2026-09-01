#!/bin/bash
# Start the Chef in My Pocket backend server

set -e
cd "$(dirname "$0")"

# Check Python venv exists
if [ ! -d "backend/venv" ]; then
    echo "Creating Python virtual environment..."
    python3 -m venv backend/venv
    backend/venv/bin/pip install -q -r backend/requirements.txt
fi

# Check .env exists
if [ ! -f .env ]; then
    echo "WARNING: .env not found. Please add your GOOGLE_API_KEY and ELEVEN_API_KEY."
    echo "You can copy .env.example if available."
fi

# Kill any existing process on port 8000
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "Port 8000 in use, killing existing process..."
    lsof -ti:8000 | xargs kill -9
    sleep 1
fi

# Start the server with hot-reload
echo "Starting backend on http://localhost:8000..."
echo "Health check: curl http://localhost:8000/health"
echo ""
PYTHONPATH=./backend:./ ./backend/venv/bin/python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
