"""Shared context variables for session tracking across modules."""

import contextvars

_session_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("session_id", default="")
