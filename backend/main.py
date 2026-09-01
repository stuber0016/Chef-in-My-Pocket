"""
FastAPI application with WebSocket endpoint for real-time Chef agent communication.
"""

import asyncio
import json
import logging
import os
import time
import uuid
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, Response

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

from agent_orchestrator import mcp_toolset, run_agent_stream
from pydantic_ai.messages import ModelRequest, ModelResponse, TextPart, ToolCallPart, ToolReturnPart
from tools import add_to_cart, clear_cart, delete_cart_item, get_cart_items, get_recipe_by_id

# Track active sessions
_active_sessions: dict[str, dict] = {}

# Track message history per session for conversation context
_session_histories: dict[str, list] = {}

# REST API session tracker
_api_sessions: dict[str, str] = {}

HEARTBEAT_INTERVAL = 30

ELEVEN_API_KEY = os.getenv("ELEVEN_API_KEY", "")
ELEVEN_STT_URL = "https://api.elevenlabs.io/v1/speech-to-text"
ELEVEN_TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech"
ELEVEN_VOICE_ID = os.getenv("ELEVEN_VOICE_ID", "EXAVITQu4vr4xnSDxMaL")  # "Sarah"


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("=" * 60)
    logger.info("Chef in My Pocket — Backend Server starting")
    async with mcp_toolset:
        logger.info("MCP toolset ready — Chef is open for business!")
        yield
    logger.info("Chef in My Pocket — Backend Server stopped")


app = FastAPI(title="Chef in My Pocket", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "recipes_db": "sqlite-fts5"}


@app.post("/api/speech-to-text")
async def speech_to_text(file: UploadFile = File(...)):
    if not ELEVEN_API_KEY:
        return {"error": "ELEVEN_API_KEY not configured"}

    content = await file.read()

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            ELEVEN_STT_URL,
            headers={"xi-api-key": ELEVEN_API_KEY},
            files={"file": ("audio.webm", content, "audio/webm")},
            data={"model_id": "scribe_v1"},
        )

    if response.status_code != 200:
        logger.error("ElevenLabs STT error: %d %s", response.status_code, response.text)
        return {"error": f"Speech recognition failed: {response.status_code}"}

    text = response.json().get("text", "").strip()
    return {"text": text}


@app.post("/api/text-to-speech")
async def text_to_speech(request: Request):
    if not ELEVEN_API_KEY:
        raise HTTPException(status_code=503, detail="ELEVEN_API_KEY not configured")

    body = await request.json()
    text = body.get("text", "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="text is required")

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{ELEVEN_TTS_URL}/{ELEVEN_VOICE_ID}",
            headers={
                "xi-api-key": ELEVEN_API_KEY,
                "Accept": "audio/mpeg",
                "Content-Type": "application/json",
            },
            json={
                "text": text,
                "model_id": "eleven_multilingual_v2",
                "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
            },
        )

    if response.status_code != 200:
        logger.error("ElevenLabs TTS error: %d %s", response.status_code, response.text[:200])
        raise HTTPException(status_code=502, detail="TTS service error")

    return Response(
        content=response.content,
        media_type="audio/mpeg",
        headers={"Cache-Control": "no-cache"},
    )


async def safe_send(websocket: WebSocket, data: dict):
    """Send data over WebSocket, silently ignoring client disconnects."""
    try:
        await websocket.send_text(json.dumps(data))
    except (RuntimeError, WebSocketDisconnect, Exception):
        pass


async def handle_message(websocket: WebSocket, user_message: str, session_id: str):
    """Process a user message through the agent, streaming text as it's generated."""
    history = _session_histories.get(session_id, [])
    await safe_send(websocket, {"type": "typing", "content": True})
    try:
        async with run_agent_stream(user_message, session_id, history) as stream:
            tool_events_sent = False
            async for text_delta in stream.stream_text(delta=True, debounce_by=0.05):
                if not tool_events_sent:
                    # First text delta means all tool calls are now complete.
                    # Send tool events before the first text chunk so the frontend
                    # can attach recipe cards to the message that follows.
                    for msg in stream.new_messages():
                        if isinstance(msg, ModelResponse):
                            for part in msg.parts:
                                if isinstance(part, ToolCallPart):
                                    await safe_send(websocket, {
                                        "type": "tool_call",
                                        "name": part.tool_name,
                                        "arguments": part.args_as_dict(),
                                        "tool_call_id": part.tool_call_id,
                                    })
                        elif isinstance(msg, ModelRequest):
                            for part in msg.parts:
                                if isinstance(part, ToolReturnPart):
                                    await safe_send(websocket, {
                                        "type": "tool_result",
                                        "tool_call_id": part.tool_call_id,
                                        "content": str(part.content),
                                    })
                    tool_events_sent = True

                await safe_send(websocket, {"type": "text", "content": text_delta})

            _session_histories[session_id] = stream.all_messages()

    except Exception as e:
        logger.exception("Agent error in session %s", session_id)
        await safe_send(websocket, {"type": "error", "content": f"Error: {str(e)}"})
    finally:
        await safe_send(websocket, {"type": "typing", "content": False})


async def heartbeat_loop(websocket: WebSocket, session_id: str):
    """Send periodic pings to keep the connection alive."""
    try:
        while True:
            await asyncio.sleep(HEARTBEAT_INTERVAL)
            await safe_send(websocket, {"type": "ping", "timestamp": time.time()})
    except (RuntimeError, WebSocketDisconnect):
        pass


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket, session_id: str | None = None):
    """WebSocket endpoint for real-time chef agent communication."""
    await websocket.accept()

    # Reuse client-provided session_id (for reconnects) or create a new one
    if not session_id:
        session_id = str(uuid.uuid4())
    _active_sessions[session_id] = {
        "created_at": time.time(),
        "last_activity": time.time(),
    }
    _api_sessions[session_id] = session_id

    heartbeat_task = asyncio.create_task(heartbeat_loop(websocket, session_id))

    try:
        while True:
            data = await websocket.receive_text()

            try:
                msg = json.loads(data)
            except json.JSONDecodeError:
                await safe_send(websocket, {"type": "error", "content": "Invalid JSON"})
                continue

            if msg.get("type") != "message":
                continue

            if session_id in _active_sessions:
                _active_sessions[session_id]["last_activity"] = time.time()

            user_message = msg.get("content", "")
            if not user_message.strip():
                continue

            await handle_message(websocket, user_message, session_id)
            await safe_send(websocket, {"type": "done", "session_id": session_id})

    except WebSocketDisconnect:
        logger.info("Client disconnected: %s", session_id)
    except Exception as e:
        logger.exception("WebSocket error for session %s: %s", session_id, e)
    finally:
        heartbeat_task.cancel()
        try:
            await heartbeat_task
        except asyncio.CancelledError:
            pass
        _active_sessions.pop(session_id, None)
        _api_sessions.pop(session_id, None)
        _session_histories.pop(session_id, None)


def _get_or_create_api_session(session_id: str | None = None) -> str:
    """Get existing API session or create a new one."""
    if session_id:
        # Trust the client-provided ID (from localStorage) and register if new
        _api_sessions.setdefault(session_id, session_id)
        return session_id
    new_id = str(uuid.uuid4())
    return new_id


@app.get("/api/cart")
async def get_cart(session_id: str | None = None):
    """Get current shopping cart."""
    sid = _get_or_create_api_session(session_id)
    cart = get_cart_items(sid)
    return JSONResponse(content={
        "session_id": sid,
        "recipes": cart["recipes"],
        "total_unique_items": cart["total_unique_items"],
        "all_items": cart["all_items"],
    })


@app.post("/api/cart")
async def post_cart(session_id: str | None = None, recipe_ids: list[int] = Query(...)):
    """Add recipes to shopping cart."""
    sid = _get_or_create_api_session(session_id)
    if not recipe_ids:
        raise HTTPException(status_code=400, detail="recipe_ids is required")
    result = add_to_cart(sid, recipe_ids)
    cart = get_cart_items(sid)
    return JSONResponse(content={
        **result,
        "session_id": sid,
        "total_unique_items_in_cart": cart["total_unique_items"],
    })


@app.delete("/api/cart")
async def delete_cart(recipe_id: int, session_id: str | None = None):
    """Remove a recipe from the shopping cart."""
    sid = _get_or_create_api_session(session_id)
    result = delete_cart_item(sid, recipe_id)
    return JSONResponse(content=result)


@app.delete("/api/cart/clear")
async def delete_cart_clear(session_id: str | None = None):
    """Clear entire shopping cart."""
    sid = _get_or_create_api_session(session_id)
    result = clear_cart(sid)
    return JSONResponse(content=result)


@app.post("/api/cart/export")
async def export_cart(session_id: str | None = None):
    """Export cart to Rohlík API (mock implementation)."""
    sid = _get_or_create_api_session(session_id)
    cart = get_cart_items(sid)

    if not cart["recipes"]:
        raise HTTPException(status_code=400, detail="Cart is empty")

    export_payload = {
        "items": [
            {
                "recipe_id": r["recipe_id"],
                "recipe_name": r["recipe_name"],
                "ingredients": r["ingredients"],
            }
            for r in cart["recipes"]
        ],
        "total_unique_items": cart["total_unique_items"],
        "all_items": cart["all_items"],
        "session_id": sid,
    }

    rohlik_endpoint = "https://api.rohlik.cz/v1/cart/import"
    logger.info("[ROHLIK MOCK] Would POST to %s: %d recipes, %d items",
                rohlik_endpoint, len(cart["recipes"]), cart["total_unique_items"])

    return JSONResponse(content={
        "status": "ok",
        "message": f"Cart exported to Rohlík ({len(cart['recipes'])} recipes, {cart['total_unique_items']} items)",
        "exported_items": len(cart["all_items"]),
        "recipes": [r["recipe_name"] for r in cart["recipes"]],
        "mock": True,
        "endpoint": rohlik_endpoint,
    })


@app.get("/api/recipes/{recipe_id}")
async def get_recipe(recipe_id: int):
    """Get a single recipe by ID."""
    recipe = get_recipe_by_id(recipe_id)
    if not recipe:
        raise HTTPException(status_code=404, detail="Recipe not found")
    return JSONResponse(content=recipe)


@app.get("/test")
async def test_page():
    """Simple test page to verify WebSocket connection."""
    return HTMLResponse("""
    <html>
    <head><title>WebSocket Test</title></head>
    <body>
        <h1>WebSocket Test</h1>
        <pre id="output"></pre>
        <script>
            const ws = new WebSocket(window.location.href.replace('http', 'ws').replace('/test', '/ws'));
            ws.onmessage = (e) => document.getElementById('output').textContent += e.data + '\\n';
            ws.onopen = () => {
                ws.send(JSON.stringify({type: 'message', content: 'Hello, Chef!'}));
            };
        </script>
    </body>
    </html>
    """)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
