"""
FastMCP server: defines tools for the Chef agent.
"""

import logging

from fastmcp import FastMCP

from context import _session_id_var
from tools import search_recipes, add_to_cart, get_cart_items

logger = logging.getLogger(__name__)

mcp = FastMCP("chef-mcp")


@mcp.tool()
async def search_recipes_tool(query: str, limit: int = 5) -> list[dict]:
    """Search for recipes by name or ingredient. Use this when the user asks for recipes
    by cuisine, ingredient, dietary preference (e.g. 'vegetarian', 'vegan', 'gluten-free'),
    or any other query about what to cook."""
    logger.info("MCP: search_recipes_tool(query=%r, limit=%d)", query, limit)
    return search_recipes(query, limit)


@mcp.tool()
async def add_to_shopping_list(recipe_ids: list[int]) -> dict:
    """Add ingredients from the specified recipes to the user's shopping list/cart.
    Only call this after the user has confirmed they want to add a recipe.
    Always call search_recipes_tool first to show the recipe details before adding."""
    session_id = _session_id_var.get() or ""
    logger.info("MCP: add_to_shopping_list(recipe_ids=%s, session=%s)", recipe_ids, session_id)
    return add_to_cart(session_id, recipe_ids)


@mcp.tool()
async def get_shopping_list() -> dict:
    """Get the current contents of the user's shopping list/cart."""
    session_id = _session_id_var.get() or ""
    logger.info("MCP: get_shopping_list(session=%s)", session_id)
    return get_cart_items(session_id)
