from datetime import datetime, timezone
from typing import Any, Literal

from pydantic import BaseModel


# ── Exception Hierarchy for Error State Disambiguation ──────────────────────
# These exceptions allow callers to distinguish between "no data" and "fetch failed".

class DataUnavailableError(Exception):
    """Base exception for temporary data unavailability (retryable)."""

    pass


class RateLimitError(DataUnavailableError):
    """Raised when rate-limited by external API (429)."""

    def __init__(self, message: str, retry_after_seconds: int | None = None) -> None:
        super().__init__(message)
        self.retry_after_seconds = retry_after_seconds


class ConnectionError(DataUnavailableError):
    """Raised when network/connection fails (timeout, DNS, refused)."""

    pass


class AuthenticationError(Exception):
    """Raised when auth fails (401, 403, invalid token)."""

    pass


class ParseError(Exception):
    """Raised when response parsing fails (malformed JSON, unexpected schema)."""

    pass


class AgentOfflineError(DataUnavailableError):
    """Raised when agent is offline/unreachable."""

    pass


# ── Data Models ──────────────────────────────────────────────────────────────


class AgentStatus(BaseModel):
    agent_id: str
    agent_type: str  # "hermes", "discord"
    name: str
    status: Literal["online", "offline", "degraded", "unknown"]
    current_task: str | None = None
    model: str | None = None
    uptime_seconds: int | None = None
    last_active: datetime | None = None
    session_count: int = 0
    error_count: int = 0
    error_message: str | None = None


class AgentSession(BaseModel):
    id: str
    agent_id: str
    title: str
    preview: str
    last_active: datetime
    duration_seconds: int | None = None
    status: Literal["active", "idle", "completed"] = "completed"
    token_count: int | None = None
    body: str | None = None
    author: str | None = None


class AgentError(BaseModel):
    id: str
    agent_id: str
    timestamp: datetime
    message: str
    severity: Literal["info", "warning", "error", "critical"] = "error"


class ActivityEvent(BaseModel):
    id: str
    agent_id: str
    event_type: Literal[
        "session", "message", "cron", "error", "skill_trigger", "vault_change"
    ]
    timestamp: datetime
    summary: str
    details: dict[str, Any] | None = None
    source: str = "hermes_api"


class InstalledSkill(BaseModel):
    name: str
    category: str | None = None
    source: str = "local"
    enabled: bool = True


class CronJob(BaseModel):
    id: str
    name: str
    schedule: str
    status: Literal["active", "paused", "error"]
    next_run: datetime | None = None
    last_run: datetime | None = None
    last_status: str | None = None


class ProjectStatus(BaseModel):
    name: str
    slug: str
    status: str
    phase_count: int = 0
    phases_complete: int = 0
    tags: list[str] = []
    updated: str = ""
    path: str = ""
    last_action: str | None = None
    next_step: str | None = None


class DashboardHealth(BaseModel):
    agents: dict[str, AgentStatus]
    server_uptime: float
    total_sessions: int
    total_skills: int


# ── Claude Code Models ────────────────────────────────────────────────────────


class ClaudeSession(BaseModel):
    """A Claude Code interactive or daemon session."""

    id: str  # sessionId UUID
    agent_id: str = "claude-code"
    pid: int | None = None  # Windows PID
    cwd: str  # normalized WSL path
    display_cwd: str  # original Windows path for UI
    version: str | None = None  # e.g. "2.1.145"
    kind: str | None = None  # "interactive" or "daemon"
    entrypoint: str | None = None  # "cli", "ide", etc.
    status: Literal["active", "idle", "offline"]
    started_at: datetime | None = None
    updated_at: datetime | None = None
    last_prompt: str | None = None  # truncated to 80 chars, redacted
    task_count: int = 0
    has_plan: bool = False


class ClaudeTask(BaseModel):
    """A task from Claude Code's task tracking."""

    id: str
    session_id: str  # UUID linking to session
    subject: str
    description: str | None = None
    active_form: str | None = None
    status: Literal["pending", "in_progress", "completed", "blocked"] = "pending"
    blocks: list[str] = []  # task IDs this blocks
    blocked_by: list[str] = []  # task IDs blocking this


class ClaudePlan(BaseModel):
    """A Claude Code execution plan file."""

    filename: str  # e.g. "phase-2-signal-core.md"
    title: str  # first heading
    mtime: datetime
    size_bytes: int
    content_preview: str | None = None  # first 500 chars, redacted


class ClaudeFileChange(BaseModel):
    """A file version tracked in Claude Code's file-history."""

    session_id: str
    file_hash: str  # content hash from filename
    version: int  # @v1, @v2, etc.
    filename: str | None = None  # derived from hash if possible
    size_bytes: int
    mtime: datetime