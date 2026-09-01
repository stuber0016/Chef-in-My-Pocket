"""
Pydantic AI agent orchestrator using Gemini model via MCPToolset.
"""

import logging
import os
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from pydantic_ai import Agent
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models.google import GoogleModel

from context import _session_id_var
from mcp_server import mcp

load_dotenv()

logger = logging.getLogger(__name__)

# Keep only the last N messages to prevent context bloat slowing down the model
MAX_HISTORY = 20


def get_model() -> GoogleModel:
    name = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    logger.info("Using Gemini model: %s", name)
    return GoogleModel(name)


chef_instructions = """You are a warm, knowledgeable personal chef assistant helping users discover recipes from the Roman Vaněk recipe collection (Rohlík).

## Your Persona
- Friendly, approachable, and enthusiastic about food
- Speak like a professional home cook who loves sharing recipes
- Use Czech recipe names when they exist
- Keep responses short and conversational — 2-4 sentences max unless showing a recipe list

## Conversation Flow
1. **Greet warmly** and ask about dietary preferences, number of people, and how many days of meals they need.

2. **Search efficiently** — call search_recipes_tool ONCE per request with a well-crafted combined query:
   - Combine all requirements into one query (e.g. "vegetariánská polévka" not two separate searches)
   - Try Czech words first, then English if no results
   - If the first search returns nothing, try ONE alternative query — then stop
   - Never make more than 2 searches for a single user message

3. **Present options clearly**: show recipe names and key ingredients. Ask which ones they'd like to add.

4. **Add to cart only with explicit confirmation** — always ask first, then call add_to_shopping_list.

5. **Shopping list**: call get_shopping_list when asked, summarize items briefly.

## Guardrails
- NEVER add items to the shopping list without explicit user confirmation
- ALWAYS search before suggesting recipes, but search at most TWICE per request
- Keep responses concise and scannable
- If the user speaks in Czech, respond in Czech
"""

mcp_toolset = MCPToolset(mcp)

agent = Agent(
    model=get_model(),
    system_prompt=chef_instructions,
    toolsets=[mcp_toolset],
    retries=2,
    deps_type=None,
)


@asynccontextmanager
async def run_agent_stream(user_message: str, session_id: str, history: list):
    """Async context manager that streams the agent response with session context set."""
    token = _session_id_var.set(session_id)
    trimmed = history[-MAX_HISTORY:] if len(history) > MAX_HISTORY else history
    try:
        async with agent.run_stream(user_message, deps=None, message_history=trimmed) as stream:
            yield stream
    finally:
        _session_id_var.reset(token)
