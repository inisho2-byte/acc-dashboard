"""Pydantic models for the Agent Chat Panel API."""

from __future__ import annotations

from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    """A single chat message in a conversation."""

    role: str  # "user" | "assistant"
    content: str = ""
    timestamp: str = ""
    tool_calls: list | None = None


class ChatRequest(BaseModel):
    """Inbound chat message from the user."""

    message: str = Field(..., max_length=10000)
    session_id: str | None = None
    model: str | None = None


class ChatResponse(BaseModel):
    """Response from a chat engine after processing a message."""

    success: bool
    response: str = ""
    session_id: str = ""
    turns: int = 0
    cost_usd: float = 0.0
    duration_ms: int = 0
    error: str | None = None
    messages: list[ChatMessage] = Field(default_factory=list)
    model: str = ""
    in_progress: bool = False


class ChatEvent(BaseModel):
    """SSE event emitted during chat processing (streaming, tool calls, etc.)."""

    type: str  # "token" | "tool_call" | "tool_result" | "done" | "error" | "heartbeat" | "cancelled"
    channel: str  # "arete" | "claude" | "shu"
    request_id: str
    content: str = ""
    tool_name: str | None = None
    tool_input: str | None = None
    tool_output: str | None = None
    session_id: str | None = None
    cost_usd: float | None = None
    duration_ms: int | None = None
