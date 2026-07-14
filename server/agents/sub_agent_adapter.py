"""Sub-agent adapter for ARETE Scout, Scribe, Reach, and Dev.

Each sub-agent runs its own Hermes Agent API server on a dedicated port.
This adapter treats them as lightweight Hermes instances — health check via
GET /health, sessions via the chat completions pattern (read from filesystem).

Ports (from ~/.hermes/profiles/<name>/config.yaml):
  Scout  → 8766
  Scribe → 8767
  Reach  → 8768
  Dev    → 8769
"""

from __future__ import annotations

import os
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml

from server.agents import AgentAdapter
from server.models import (
    AgentError,
    AgentOfflineError,
    AgentSession,
    AgentStatus,
    ConnectionError,
)
from server.utils.circuit_breaker import CircuitBreaker, CircuitBreakerConfig

logger = logging.getLogger("acc-dashboard.sub_agent")

HERMES_HOME = Path.home() / ".hermes"
PROFILES_DIR = HERMES_HOME / "profiles"
SESSIONS_DIR = HERMES_HOME / "sessions"

# Display metadata for each sub-agent
AGENT_META = {
    "scout":  {"display_name": "Scout",  "color": "#00ff88", "domain": "Research", "model_key": "gpt-oss:120b"},
    "scribe": {"display_name": "Scribe", "color": "#f59e0b", "domain": "Writing",  "model_key": "gemma4:31b"},
    "reach":  {"display_name": "Reach",  "color": "#a78bfa", "domain": "Marketing", "model_key": "glm-4.7"},
    "dev":    {"display_name": "Dev",    "color": "#f472b6", "domain": "Build",     "model_key": "glm-5.1"},
}


def _load_port_from_profile(agent_id: str) -> int:
    """Read the API port from the agent's profile config.yaml."""
    profile_path = PROFILES_DIR / agent_id / "config.yaml"
    if profile_path.is_file():
        try:
            with open(profile_path) as f:
                cfg = yaml.safe_load(f) or {}
            api_cfg = cfg.get("platforms", {}).get("api_server", {})
            port = api_cfg.get("port")
            if port:
                return int(port)
        except Exception as exc:
            logger.warning(f"sub_agent_port_read_failed", extra={"agent": agent_id, "error": str(exc)})
    # Fallback defaults
    defaults = {"scout": 8766, "scribe": 8767, "reach": 8768, "dev": 8769}
    return defaults.get(agent_id, 8766)


def _load_model_from_profile(agent_id: str) -> str:
    """Read the default model from the agent's profile config.yaml."""
    profile_path = PROFILES_DIR / agent_id / "config.yaml"
    if profile_path.is_file():
        try:
            with open(profile_path) as f:
                cfg = yaml.safe_load(f) or {}
            model = cfg.get("model", {}).get("default", "")
            provider = cfg.get("model", {}).get("provider", "")
            if model and provider:
                return f"{model} @ {provider}"
            if model:
                return model
        except Exception:
            pass
    meta = AGENT_META.get(agent_id, {})
    return meta.get("model_key", "unknown")


class SubAgentAdapter(AgentAdapter):
    """Adapter for ARETE sub-agents (Scout, Scribe, Reach, Dev).

    Communicates with each agent's Hermes API server for health checks.
    Reads session data from the agent's profile session directory.
    """

    agent_type = "hermes-sub"

    def __init__(self, agent_id: str) -> None:
        assert agent_id in AGENT_META, f"Unknown sub-agent: {agent_id}"
        self._agent_id = agent_id
        meta = AGENT_META[agent_id]
        self._display_name = meta["display_name"]
        self._color = meta["color"]
        self._domain = meta["domain"]
        self._port = _load_port_from_profile(agent_id)
        self._base_url = f"http://127.0.0.1:{self._port}"
        self._model = _load_model_from_profile(agent_id)
        self._last_errors: list[AgentError] = []
        self._client = httpx.AsyncClient(timeout=10.0)
        # Circuit breaker for health checks
        self._cb_health = CircuitBreaker(
            f"sub_{agent_id}_health",
            CircuitBreakerConfig(failure_threshold=3, timeout_seconds=30.0),
        )

    @property
    def agent_id(self) -> str:
        return self._agent_id

    @property
    def display_name(self) -> str:
        return self._display_name

    def status_from_online(self, online: bool) -> str:
        return "online" if online else "offline"

    async def health(self) -> AgentStatus:
        async def _health_impl() -> AgentStatus:
            try:
                resp = await self._client.get(f"{self._base_url}/health")
                resp.raise_for_status()
                data = resp.json()
                online = data.get("status") == "ok"
            except Exception:
                online = False

            return AgentStatus(
                agent_id=self._agent_id,
                agent_type=self.agent_type,
                name=f"ARETE {self._display_name}",
                status="online" if online else "offline",
                current_task=None,
                model=self._model,
                uptime_seconds=None,
                last_active=datetime.now(timezone.utc),
                session_count=0,
                error_count=len(self._last_errors),
                error_message=None,
            )

        try:
            return await self._cb_health.call(_health_impl)
        except Exception as exc:
            self._record_error(str(exc))
            return AgentStatus(
                agent_id=self._agent_id,
                agent_type=self.agent_type,
                name=f"ARETE {self._display_name}",
                status="offline",
                current_task=None,
                model=self._model,
                error_message=str(exc),
            )

    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]:
        """Read recent sessions from the agent's profile session directory."""
        agent_sessions_dir = PROFILES_DIR / self._agent_id / "sessions"
        sessions: list[AgentSession] = []

        if not agent_sessions_dir.is_dir():
            # Fallback: read from main sessions dir filtering by agent context
            return sessions

        try:
            session_files = sorted(
                agent_sessions_dir.glob("*.jsonl"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )[:limit]

            for sf in session_files:
                try:
                    mtime = sf.stat().st_mtime
                    last_active = datetime.fromtimestamp(mtime, tz=timezone.utc)
                    # Read first line for title/preview
                    title = ""
                    preview = ""
                    with open(sf, "r", encoding="utf-8", errors="replace") as f:
                        first_line = f.readline().strip()
                        if first_line:
                            try:
                                import json
                                entry = json.loads(first_line)
                                content = entry.get("content", "")
                                title = content[:80] if content else sf.stem
                                preview = content[:200] if content else ""
                            except Exception:
                                title = sf.stem
                                preview = ""

                    sessions.append(AgentSession(
                        id=sf.stem,
                        agent_id=self._agent_id,
                        title=title or sf.stem,
                        preview=preview,
                        last_active=last_active,
                        status="completed",
                    ))
                except Exception:
                    continue
        except Exception as exc:
            logger.debug(f"sub_agent_sessions_error", extra={"agent": self._agent_id, "error": str(exc)})

        return sessions[:limit]

    async def recent_errors(self, limit: int = 10) -> list[AgentError]:
        return list(self._last_errors[-limit:])

    def _record_error(self, message: str, severity: str = "error") -> None:
        self._last_errors.append(
            AgentError(
                id=f"sub_{self._agent_id}-{datetime.now(timezone.utc).isoformat()}",
                agent_id=self._agent_id,
                timestamp=datetime.now(timezone.utc),
                message=message,
                severity=severity,
            )
        )
        if len(self._last_errors) > 100:
            self._last_errors = self._last_errors[-100:]