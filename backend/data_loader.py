"""
Data layer: parses dataset.csv into an in-memory SQLite database with FTS5 indexing.
Provides search_recipes() for full-text search over recipe names and ingredients.
"""

import csv
import sqlite3
import threading
from pathlib import Path

DB_PATH = Path(__file__).parent / "recipes.db"

# Thread-local storage for database connections
_db_local = threading.local()


def _create_db() -> sqlite3.Connection:
    """Create and initialize the in-memory SQLite database."""
    conn = sqlite3.connect(":memory:")
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")

    # Create main table
    conn.execute("""
        CREATE TABLE recipes (
            id INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            author_name TEXT,
            author_note TEXT,
            ingredients TEXT,
            steps TEXT
        )
    """)

    # Create FTS5 virtual table
    conn.execute("""
        CREATE VIRTUAL TABLE recipes_fts USING fts5(name, ingredients, content='recipes', content_rowid='rowid')
    """)

    # Sync trigger
    conn.execute("""
        CREATE TRIGGER recipes_ai AFTER INSERT ON recipes BEGIN
            INSERT INTO recipes_fts(rowid, name, ingredients)
            VALUES (new.id, new.name, new.ingredients);
        END
    """)

    # Load CSV
    csv_path = Path(__file__).parent.parent / "dataset.csv"
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader):
            conn.execute(
                "INSERT INTO recipes VALUES (?, ?, ?, ?, ?, ?)",
                (
                    int(row["id"]),
                    row["name"],
                    row.get("author_name", ""),
                    row.get("author_note", ""),
                    row.get("ingredients", ""),
                    row.get("steps", ""),
                ),
            )

    conn.commit()
    return conn


def get_db() -> sqlite3.Connection:
    """Get a thread-local database connection, creating one if needed."""
    if not hasattr(_db_local, "conn") or _db_local.conn is None:
        _db_local.conn = _create_db()
    return _db_local.conn


def close_db():
    """Close the thread-local database connection."""
    if hasattr(_db_local, "conn") and _db_local.conn:
        _db_local.conn.close()
        _db_local.conn = None


def init_db():
    """Deprecated: Use get_db() instead. Kept for backward compatibility."""
    return get_db()


def _highlight_match(text: str, query: str, max_len: int = 120) -> str:
    """Simple highlight: find query term in text and add markers."""
    if not text:
        return ""
    text_lower = text.lower()
    query_lower = query.lower()
    idx = text_lower.find(query_lower)
    if idx == -1:
        return text[:max_len]
    start = max(0, idx - 30)
    end = min(len(text), idx + len(query) + 40)
    snippet = text[start:end]
    if start > 0:
        snippet = "..." + snippet
    if end < len(text):
        snippet = snippet + "..."
    return snippet.replace(query, f"[{query}]", 1)


def search_recipes(conn: sqlite3.Connection, query: str, limit: int = 5) -> list[dict]:
    """Full-text search over recipes, return top N results with highlights."""
    cur = conn.execute("""
        SELECT r.id, r.name, r.ingredients
        FROM recipes_fts
        JOIN recipes r ON r.rowid = recipes_fts.rowid
        WHERE recipes_fts MATCH ?
        ORDER BY rank
        LIMIT ?
    """, (query, limit))

    results = []
    for row in cur.fetchall():
        results.append({
            "id": row[0],
            "name": row[1],
            "ingredients": row[2],
            "name_highlight": _highlight_match(row[1], query),
        })
    return results


def get_recipe_by_id(conn: sqlite3.Connection, recipe_id: int) -> dict | None:
    """Fetch a single recipe by ID."""
    cur = conn.execute(
        "SELECT id, name, ingredients, steps FROM recipes WHERE id = ?",
        (recipe_id,),
    )
    row = cur.fetchone()
    if row:
        return {"id": row[0], "name": row[1], "ingredients": row[2], "steps": row[3]}
    return None
