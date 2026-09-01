# Chef in My Pocket — System Design

## 1. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        User                                      │
│         (browser: text input OR microphone)                     │
└────────────────────┬────────────────────────────────────────────┘
                     │ WebSocket (streaming JSON)
                     │ HTTP  (STT / TTS / cart REST)
┌────────────────────▼────────────────────────────────────────────┐
│                  Next.js Frontend  (port 3000)                  │
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐  │
│  │  ChatArea    │  │  VoiceOrb    │  │  ShoppingCartUI      │  │
│  │  (streaming  │  │  (record →   │  │  (/cart page,        │  │
│  │   messages,  │  │   POST STT,  │  │   REST /api/cart)    │  │
│  │   recipe     │  │   send text) │  │                      │  │
│  │   cards)     │  │              │  │                      │  │
│  └──────────────┘  └──────────────┘  └──────────────────────┘  │
│                                                                  │
│  localStorage: session_id + message history (survives reload)   │
└────────────────────┬────────────────────────────────────────────┘
                     │
          ┌──────────┴────────────────────────────┐
          │ WebSocket /ws                          │ HTTP /api/*
┌─────────▼────────────────────────────────────────────────────┐
│                 FastAPI Backend  (port 8000)                  │
│                                                               │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              Agent Orchestrator (Pydantic AI)            │ │
│  │                                                          │ │
│  │  Agent(GoogleModel("gemini-2.5-flash-lite"),             │ │
│  │        system_prompt=chef_instructions,                  │ │
│  │        toolsets=[MCPToolset(mcp)])                       │ │
│  │                                                          │ │
│  │  • run_stream() → token-by-token streaming               │ │
│  │  • message_history trimmed to last 20 messages           │ │
│  │  • _session_id_var (contextvars) scopes cart ops         │ │
│  └───────────────────────┬─────────────────────────────────┘ │
│                           │ in-process MCP call               │
│  ┌────────────────────────▼────────────────────────────────┐ │
│  │                FastMCP Server (in-process)               │ │
│  │                                                          │ │
│  │  search_recipes_tool(query, limit)                       │ │
│  │  add_to_shopping_list(recipe_ids)                        │ │
│  │  get_shopping_list()                                     │ │
│  └───────────┬───────────────────────┬──────────────────── ┘ │
│              │                       │                        │
│  ┌───────────▼──────────┐  ┌─────────▼──────────────────┐   │
│  │   Data Layer         │  │   Shopping Cart             │   │
│  │   (data_loader.py)   │  │   (tools.py)                │   │
│  │                      │  │                             │   │
│  │  SQLite :memory:     │  │  In-memory dict per session │   │
│  │  + FTS5 virtual      │  │  _carts[session_id]         │   │
│  │    table             │  │  → {recipe_id: {name,       │   │
│  │  dataset.csv →       │  │       ingredients[]}}       │   │
│  │  ~3 000 recipes      │  │                             │   │
│  └──────────────────────┘  └─────────────────────────────┘   │
│                                                               │
│  ┌────────────────────────────────────────────────────────┐  │
│  │              ElevenLabs Voice Bridge                    │  │
│  │                                                         │  │
│  │  POST /api/speech-to-text  → scribe_v1  (STT)          │  │
│  │  POST /api/text-to-speech  → eleven_multilingual_v2    │  │
│  │                               (TTS, voice "Sarah")     │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
                     │
          ┌──────────▼──────────┐
          │  Google AI (Gemini) │
          │  gemini-2.5-flash   │
          │  -lite  via API     │
          └─────────────────────┘
```

### Data flow — one user turn

```
User speaks  ──►  VoiceOrb records WebM audio
                  │
                  ▼ POST /api/speech-to-text
             ElevenLabs scribe_v1 transcribes
                  │
                  ▼ WebSocket { type:"message", content }
             FastAPI receives, looks up session history
                  │
                  ▼ agent.run_stream(message, history)
             Gemini reasons, decides to call a tool
                  │
                  ▼ MCPToolset dispatches to FastMCP
             search_recipes_tool / add_to_shopping_list
                  │
                  ▼ SQLite FTS5 query or in-memory cart
             Results returned to Gemini
                  │
                  ▼ Gemini generates response text
             Streaming token deltas  ──►  WebSocket { type:"text" }
                  │
                  ▼ { type:"done" }
             Frontend accumulates text  ──►  POST /api/text-to-speech
                  │
             ElevenLabs returns MP3  ──►  browser Audio plays
```

---

## 2. Key Technical Choices

### Agent Framework — Pydantic AI

**Why Pydantic AI over LangChain, LlamaIndex, or a raw API loop?**

Pydantic AI is a thin, typed wrapper around LLM calls that integrates native MCP toolset support and first-class streaming. It was chosen for three reasons:

1. **Native MCPToolset** — the MCP server is wired directly into the agent with a single `MCPToolset(mcp)` argument. No custom tool-parsing or JSON serialisation boilerplate is needed; Pydantic AI handles the full round-trip between the LLM function call and the MCP server.

2. **Streaming built in** — `agent.run_stream()` yields text deltas natively, which lets the FastAPI backend push tokens to the browser as they arrive without buffering the full response.

3. **Typed, minimal surface area** — the framework exposes one `Agent` class and one `run_stream` context manager. This kept the orchestration layer small (~80 lines) and easy to reason about, which matters for a hackathon-style MVP.

LangChain was considered but rejected because its MCP adapters are still third-party and the abstraction overhead (chains, callbacks, LCEL) adds complexity without benefiting a single-agent use-case.

### MCP Server — FastMCP (in-process)

The MCP server runs **in the same Python process** as FastAPI using FastMCP's ASGI/in-memory transport. This avoids the network overhead and process-management complexity of a separate subprocess while still exposing a standard MCP interface. The server exposes exactly three tools:

| Tool | Purpose |
|---|---|
| `search_recipes_tool` | Full-text search over the recipe dataset |
| `add_to_shopping_list` | Adds recipe ingredients to the session cart (requires explicit user confirmation per guardrail) |
| `get_shopping_list` | Returns the current cart contents |

### Data Store — SQLite FTS5 (in-memory)

The ~3,000-recipe CSV is loaded once at startup into an in-memory SQLite database with a **FTS5 virtual table** over `name` and `ingredients`. This gives fast ranked full-text search (including Czech diacritics) with zero external dependencies. The trade-off is that the data lives only in RAM and is re-parsed on every restart, which is acceptable at this scale.

### Voice — ElevenLabs STT + TTS

ElevenLabs was specified as the target voice technology. The integration uses:

- **`scribe_v1`** for speech-to-text: handles WebM/Opus audio from the browser's MediaRecorder API with good accuracy on Czech and English.
- **`eleven_multilingual_v2`** for text-to-speech: the multilingual model is essential because the agent responds in the user's language (Czech or English). The "Sarah" voice (`EXAVITQu4vr4xnSDxMaL`) was chosen for its neutral, conversational tone.

TTS is applied to only the **first ~300 characters** of each response (trimmed at a sentence boundary) to keep voice output brief and reduce latency.

### Session & Memory

Conversational memory is kept **server-side** as a plain Python list of Pydantic AI message objects, keyed by `session_id` (a UUID). The list is trimmed to the last 20 exchanges (`MAX_HISTORY = 20`) to keep context size bounded and model latency stable across long sessions.

The `session_id` is also stored in the browser's `localStorage` so that a page reload reconnects to the same session (same cart, same history) rather than starting fresh.

Cart state is stored in an **in-memory Python dict** (`_carts[session_id]`). This is a deliberate simplification: for production the cart would be persisted in a database or delegated to the live Rohlik cart API (a mock export endpoint `POST /api/cart/export` is included to show where that integration would live).

