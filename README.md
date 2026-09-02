# Chef in My Pocket

A conversational meal-planning agent for Rohlík. Tell it your dietary goal and how many days of meals you need — it searches the Roman Vaněk recipe collection, builds a meal plan, and populates your shopping list. Supports both text and voice input via ElevenLabs.

---

## Prerequisites

| Tool | Min version |
|---|---|
| Python | 3.11+ |
| Node.js | 18+ |
| Yarn | 1.x |

You need two API keys:

- **Google AI** (Gemini) — [aistudio.google.com](https://aistudio.google.com) → *Get API key*
- **ElevenLabs** — [elevenlabs.io](https://elevenlabs.io) → *Profile → API Key* (voice features require an active plan; the app works in text-only mode without it)

---

## 1 — Clone & configure

```bash
git clone <repo-url>
cd rohlik
```

Copy the example env file and fill in your keys:

```bash
cp .env.example .env
```

Edit `.env`:

```
GOOGLE_API_KEY=your_google_ai_key_here
ELEVEN_API_KEY=your_elevenlabs_key_here   # optional — leave blank to disable voice
GEMINI_MODEL=gemini-3.5-flash-lite        
ELEVEN_VOICE_ID=EXAVITQu4vr4xnSDxMaL     # "Sarah" — change to any ElevenLabs voice ID
```

---

## 2 — Start the backend

```bash
./run-backend.sh
```

This script:
1. Creates a Python virtual environment in `backend/venv/` on first run
2. Installs dependencies from `backend/requirements.txt`
3. Starts FastAPI + Uvicorn with hot-reload on **http://localhost:8000**

Verify it's running:

```bash
curl http://localhost:8000/health
# {"status":"ok","recipes_db":"sqlite-fts5"}
```

> **Manual setup** (if you prefer not to use the script):
> ```bash
> cd backend
> python3 -m venv venv
> venv/bin/pip install -r requirements.txt
> PYTHONPATH=. venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
> ```

---

## 3 — Start the frontend

In a second terminal:

```bash
cd frontend       # or: cd rohlik/frontend if you're at the repo root
yarn install
yarn dev
```

The app is available at **http://localhost:3000**.

---

## 4 — Use the app

1. Open [http://localhost:3000](http://localhost:3000).
2. The chef greets you — tell it your dietary goal and how many days of meals you need (e.g. *"vegetarian, 3 days"*).
3. It searches recipes, presents options, and asks for confirmation before adding anything to your cart.
4. Click the microphone orb (right sidebar on desktop) to speak instead of type.
5. Visit [http://localhost:3000/cart](http://localhost:3000/cart) to review your shopping list.
6. Use *"New conversation"* (top of chat) to reset the session and start fresh.

---

## Project structure

```
rohlik/
├── backend/
│   ├── main.py               # FastAPI app, WebSocket endpoint, voice bridge
│   ├── agent_orchestrator.py # Pydantic AI agent + Gemini model
│   ├── mcp_server.py         # FastMCP server — 3 tools exposed to the agent
│   ├── tools.py              # Recipe search + shopping cart logic
│   ├── data_loader.py        # Loads dataset.csv into SQLite FTS5
│   └── requirements.txt
├── frontend/
│   ├── app/
│   │   ├── page.tsx          # Main chat page
│   │   └── cart/page.tsx     # Shopping cart page
│   └── components/
│       ├── ChatArea.tsx      # WebSocket chat + streaming + recipe cards
│       ├── VoiceOrb.tsx      # Microphone record → STT → send message
│       ├── ShoppingCartUi.tsx
│       └── TopNavbar.tsx
├── dataset.csv               # Roman Vaněk recipe collection (~3 000 recipes)
├── .env.example
├── run-backend.sh
└── SYSTEM_DESIGN.md          # Architecture diagram + technical decisions
```

---

## Environment variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `GOOGLE_API_KEY` | Yes | — | Google AI Studio key for Gemini |
| `ELEVEN_API_KEY` | No | — | ElevenLabs key; voice disabled if blank |
| `GEMINI_MODEL` | No | `gemini-2.5-flash-lite` | Any Gemini model ID |
| `ELEVEN_VOICE_ID` | No | `EXAVITQu4vr4xnSDxMaL` | ElevenLabs voice ID |

The frontend reads `NEXT_PUBLIC_API_URL` (defaults to `http://localhost:8000`) if the backend runs on a different host.

---

## Troubleshooting

**Port 8000 already in use** — `run-backend.sh` kills the occupying process automatically. To do it manually: `lsof -ti:8000 | xargs kill -9`.

**Voice not working** — check that `ELEVEN_API_KEY` is set and that your browser granted microphone access (look for the lock icon in the address bar).

**No recipes returned** — make sure `dataset.csv` is present at the repo root. The data layer loads it on startup; a missing file will crash the backend with a `FileNotFoundError`.

**Agent gives generic answers** — try a more specific query, or prefix with Czech words (the dataset is primarily Czech).
