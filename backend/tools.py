"""
Shared tool logic for both MCP server and Pydantic AI agent.
Core recipe search and shopping list operations.
"""

import logging
from typing import Dict, List

from data_loader import get_db, search_recipes as _search_recipes, get_recipe_by_id as _get_recipe_by_id

logger = logging.getLogger(__name__)


def search_recipes(query: str, limit: int = 5) -> list[dict]:
    """Search recipes by name or ingredient."""
    conn = get_db()
    try:
        return _search_recipes(conn, query, limit)
    except Exception as e:
        logger.error("search_recipes failed for query=%r: %s", query, e)
        return []


def get_recipe_by_id(recipe_id: int):
    """Get a single recipe by ID."""
    conn = get_db()
    try:
        return _get_recipe_by_id(conn, recipe_id)
    except Exception as e:
        logger.error("get_recipe_by_id failed for id=%r: %s", recipe_id, e)
        return None


# In-memory cart storage (per-session)
_carts: Dict[str, Dict[int, dict]] = {}


def _get_or_create_cart(session_id: str) -> dict:
    """Get or create cart for a session."""
    if session_id not in _carts:
        _carts[session_id] = {}
    return _carts[session_id]


def add_to_cart(session_id: str, recipe_ids: list[int]) -> dict:
    """Add recipes to the shopping cart. Returns summary."""
    cart = _get_or_create_cart(session_id)
    added_count = 0
    last_recipe_name = "unknown"

    for recipe_id in recipe_ids:
        recipe = get_recipe_by_id(recipe_id)
        if recipe:
            ingredients_list = [
                ing.strip() for ing in recipe["ingredients"].split(",") if ing.strip()
            ]
            cart[recipe_id] = {
                "recipe_id": recipe_id,
                "recipe_name": recipe["name"],
                "ingredients": ingredients_list,
            }
            added_count += len(ingredients_list)
            last_recipe_name = recipe["name"]
            logger.info("[MOCK ROHLIK API] Added '%s' (%d): %s", recipe['name'], recipe_id, ', '.join(ingredients_list[:8]))

    all_items: list[str] = []
    for item in cart.values():
        all_items.extend(item.get("ingredients", []))
    unique_count = len(set(i.strip().lower() for i in all_items if i.strip()))

    return {
        "status": "ok",
        "recipe_name": last_recipe_name,
        "items_added": added_count,
        "total_unique_items_in_cart": unique_count,
    }


def get_cart_items(session_id: str) -> dict:
    """Get current shopping cart contents."""
    cart = _get_or_create_cart(session_id)
    recipes = list(cart.values())
    all_items: list[str] = []
    for item in recipes:
        all_items.extend(item.get("ingredients", []))
    unique_count = len(set(i.strip().lower() for i in all_items if i.strip()))

    return {
        "recipes": recipes,
        "total_unique_items": unique_count,
        "all_items": all_items,
    }


def delete_cart_item(session_id: str, recipe_id: int) -> dict:
    """Remove a recipe from the shopping cart."""
    cart = _get_or_create_cart(session_id)
    cart.pop(recipe_id, None)
    recipes = list(cart.values())
    all_items: list[str] = []
    for item in recipes:
        all_items.extend(item.get("ingredients", []))
    unique_count = len(set(i.strip().lower() for i in all_items if i.strip()))

    return {
        "status": "ok",
        "removed_recipe_id": recipe_id,
        "total_unique_items": unique_count,
        "remaining_items": len(all_items),
    }


def clear_cart(session_id: str) -> dict:
    """Clear entire shopping cart."""
    _carts[session_id] = {}
    return {"status": "ok", "message": "Cart cleared"}
