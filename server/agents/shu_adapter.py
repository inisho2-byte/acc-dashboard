from __future__ import annotations

import os
from datetime import datetime, timezone
import httpx

from server.agents import AgentAdapter
from server.models import (
    AgentError,
    AgentOfflineError,
    AgentSession,
    AgentStatus,
    AuthenticationError,
    ConnectionError,
    ParseError,
    RateLimitError,
)
from server.utils.circuit_breaker import CircuitBreaker, CircuitBreakerConfig

DISCORD_API = "https://discord.com/api/v10"


class ShuDiscordAdapter(AgentAdapter):
    """Adapter for Shu — monitors via Discord channel messages."""

    agent_id = "shu"
    agent_type = "discord"
    display_name = "Shu"

    max_errors: int = 100

    def __init__(self, channel_id: str, env_token_var: str = "DISCORD_BOT_TOKEN") -> None:
        self._channel_id = channel_id
        token = os.environ.get(env_token_var, "")
        if not token:
            # Fallback: try to source from ~/.hermes/.env
            env_path = os.path.expanduser("~/.hermes/.env")
            if os.path.isfile(env_path):
                with open(env_path) as f:
                    for line in f:
                        if line.startswith(env_token_var + "="):
                            token = line.strip().split("=", 1)[1].strip('"').strip("'")
                            break
        self._token = token
        self._last_errors: list[AgentError] = []
        # Circuit breakers for failing operations
        self._cb_health = CircuitBreaker("shu_health", CircuitBreakerConfig(failure_threshold=3, timeout_seconds=30.0))
        self._cb_sessions = CircuitBreaker("shu_sessions", CircuitBreakerConfig(failure_threshold=3, timeout_seconds=30.0))

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bot {self._token}",
            "Content-Type": "application/json",
        }

    async def _fetch_channel_name(self) -> str:
        """Get channel name for display purposes."""
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                f"{DISCORD_API}/channels/{self._channel_id}",
                headers=self._headers(),
            )
            if resp.is_success:
                data = resp.json()
                return data.get("name", self._channel_id)
            return self._channel_id

    def _record_error(self, message: str, severity: str = "error") -> None:
        """Record error in persistent buffer (append-only, capped at max_errors)."""
        self._last_errors.append(
            AgentError(
                id=f"shu-{datetime.now(timezone.utc).isoformat()}",
                agent_id=self.agent_id,
                timestamp=datetime.now(timezone.utc),
                message=message,
                severity=severity,
            )
        )
        if len(self._last_errors) > self.max_errors:
            self._last_errors = self._last_errors[-self.max_errors:]

    # ── public API ─────────────────────────────────────────────

    async def health(self) -> AgentStatus:
        async def _health_impl() -> AgentStatus:
            if not self._token:
                self._record_error("No Discord bot token configured")
                raise AuthenticationError("No Discord bot token configured")

            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        f"{DISCORD_API}/channels/{self._channel_id}/messages?limit=1",
                        headers=self._headers(),
                    )
                    if resp.status_code == 429:
                        retry_after = int(resp.headers.get("Retry-After", "60"))
                        self._record_error(f"Discord rate limited (channel {self._channel_id})")
                        raise RateLimitError(
                            f"Discord rate limited (channel {self._channel_id})",
                            retry_after_seconds=retry_after,
                        )
                    if resp.status_code in (401, 403):
                        self._record_error(f"Discord auth failed (HTTP {resp.status_code})")
                        raise AuthenticationError(
                            f"Discord auth failed (HTTP {resp.status_code}) - check bot token"
                        )
                    if resp.status_code == 404:
                        self._record_error(f"Discord channel {self._channel_id} not found")
                        raise AgentOfflineError(
                            f"Discord channel {self._channel_id} not found"
                        )
                    if resp.is_error:
                        self._record_error(f"Discord API error: HTTP {resp.status_code}")
                        raise AgentOfflineError(
                            f"Discord API error: HTTP {resp.status_code}"
                        )

                    messages = resp.json()
                    last_active = None
                    if messages:
                        last_active = datetime.fromisoformat(
                            messages[0]["timestamp"].replace("Z", "+00:00")
                        )

                    return AgentStatus(
                        agent_id=self.agent_id,
                        agent_type=self.agent_type,
                        name=self.display_name,
                        status="online",
                        last_active=last_active,
                    )

            except httpx.TimeoutException as exc:
                self._record_error(f"Discord request timeout: {exc}")
                raise ConnectionError(f"Discord request timeout: {exc}")
            except httpx.RequestError as exc:
                self._record_error(f"Discord connection failed: {exc}")
                raise ConnectionError(f"Discord connection failed: {exc}")
        
        return await self._cb_health.call(_health_impl)

    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]:
        """Fetch recent messages from Shu's channel as 'sessions'."""
        async def _sessions_impl() -> list[AgentSession]:
            if not self._token:
                raise AuthenticationError("No Discord bot token configured")

            # Discord API max is 100 per request
            discord_limit = min(limit, 100)
            try:
                async with httpx.AsyncClient(timeout=10) as client:
                    resp = await client.get(
                        f"{DISCORD_API}/channels/{self._channel_id}/messages?limit={discord_limit}",
                        headers=self._headers(),
                    )
                    if resp.status_code == 429:
                        retry_after = int(resp.headers.get("Retry-After", "60"))
                        raise RateLimitError(
                            f"Discord rate limited (channel {self._channel_id})",
                            retry_after_seconds=retry_after,
                        )
                    if resp.status_code in (401, 403):
                        raise AuthenticationError(
                            f"Discord auth failed (HTTP {resp.status_code}) - check bot token"
                        )
                    if resp.status_code == 404:
                        raise AgentOfflineError(
                            f"Discord channel {self._channel_id} not found"
                        )
                    if resp.is_error:
                        raise ConnectionError(
                            f"Discord API error: HTTP {resp.status_code}"
                        )

                    try:
                        messages = resp.json()
                    except (ValueError, KeyError) as exc:
                        raise ParseError(f"Failed to parse Discord response: {exc}")

                    sessions: list[AgentSession] = []
                    for msg in messages:
                        ts = datetime.fromisoformat(
                            msg["timestamp"].replace("Z", "+00:00")
                        )
                        content = msg.get("content", "") or "(embed or attachment)"
                        preview = content[:80] + ("…" if len(content) > 80 else "")
                        sessions.append(
                            AgentSession(
                                id=f"shu-{msg['id']}",
                                agent_id=self.agent_id,
                                title=f"Message from {msg['author']['username']}",
                                preview=preview,
                                last_active=ts,
                                body=content,
                                author=msg["author"]["username"],
                            )
                        )
                    return sessions

            except httpx.TimeoutException as exc:
                raise ConnectionError(f"Discord request timeout: {exc}")
            except httpx.RequestError as exc:
                raise ConnectionError(f"Discord connection failed: {exc}")
        
        return await self._cb_sessions.call(_sessions_impl)

    async def recent_errors(self, limit: int = 10) -> list[AgentError]:
        # Persistent error buffer — returns last N without draining
        return self._last_errors[-limit:]
