from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx

from server.agents import AgentAdapter
from server.models import (
    AgentError,
    AgentOfflineError,
    AgentSession,
    AgentStatus,
    ConnectionError,
    ParseError,
)
from server.utils.circuit_breaker import CircuitBreaker, CircuitBreakerConfig

HERMES_HOME = Path.home() / ".hermes"
SKILLS_DIR = HERMES_HOME / "skills"
SESSIONS_DIR = HERMES_HOME / "sessions"


class HermesAdapter(AgentAdapter):
    """Adapter for the Hermes Agent via the official api_server (port 8642).

    Reads skills and sessions from the local filesystem (no custom endpoints).
    Dispatches tasks via POST /v1/chat/completions.
    Reads cron jobs via GET /api/jobs.
    """

    agent_id = "arete"
    agent_type = "hermes"
    display_name = "ARETE"

    def __init__(self, base_url: str = "http://localhost:8642") -> None:
        self._base_url = base_url.rstrip("/")
        self._last_errors: list[AgentError] = []
        self._client = httpx.AsyncClient(timeout=15.0)
        # Circuit breakers for failing operations
        self._cb_health = CircuitBreaker("hermes_health", CircuitBreakerConfig(failure_threshold=3, timeout_seconds=30.0))
        self._cb_sessions = CircuitBreaker("hermes_sessions", CircuitBreakerConfig(failure_threshold=3, timeout_seconds=30.0))
        self._cb_cron = CircuitBreaker("hermes_cron", CircuitBreakerConfig(failure_threshold=3, timeout_seconds=30.0))
        self._cb_skills = CircuitBreaker("hermes_skills", CircuitBreakerConfig(failure_threshold=3, timeout_seconds=30.0))
        self._cb_dispatch = CircuitBreaker("hermes_dispatch", CircuitBreakerConfig(failure_threshold=2, timeout_seconds=60.0))

    # ── helpers ────────────────────────────────────────────────

    async def _retry_request(self, method: str, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        """Make an HTTP request with exponential backoff retry for transient failures."""
        url = f"{self._base_url}{path}"
        last_exc: Exception | None = None

        for attempt in range(3):  # initial + 2 retries
            try:
                if method == "GET":
                    resp = await self._client.get(url)
                else:
                    resp = await self._client.post(url, json=json)
                resp.raise_for_status()
                return resp.json()
            except (httpx.TimeoutException, httpx.ConnectError) as exc:
                last_exc = exc
                if attempt < 2:
                    delay = 1.0 * (2 ** attempt)  # 1s, 2s
                    await asyncio.sleep(delay)
                continue
            except httpx.HTTPStatusError as exc:
                raise ConnectionError(f"Hermes API error {exc.response.status_code}: {exc}")
            except (ValueError, TypeError) as exc:
                raise ParseError(f"Invalid JSON from Hermes API: {exc}")

        if isinstance(last_exc, httpx.TimeoutException):
            raise ConnectionError(f"Hermes API timeout after retries: {last_exc}")
        raise AgentOfflineError(f"Hermes API unreachable after retries: {last_exc}")

    async def _get(self, path: str) -> dict[str, Any]:
        return await self._retry_request("GET", path)

    async def _post(self, path: str, json: dict[str, Any] | None = None) -> dict[str, Any]:
        return await self._retry_request("POST", path, json=json)

    def _record_error(self, message: str, severity: str = "error") -> None:
        self._last_errors.append(
            AgentError(
                id=f"hermes-http-{datetime.now(timezone.utc).isoformat()}",
                agent_id=self.agent_id,
                timestamp=datetime.now(timezone.utc),
                message=message,
                severity=severity,
            )
        )

    # ── public API ─────────────────────────────────────────────

    async def health(self) -> AgentStatus:
        async def _health_impl() -> AgentStatus:
            try:
                data = await self._get("/health")
            except Exception as exc:
                self._record_error(str(exc))
                raise AgentOfflineError(f"Hermes API unavailable: {exc}")

            online = data.get("status") == "ok" or data.get("online", False)
            model = data.get("model", "unknown")
            session_count = data.get("session_count", 0)
            uptime = data.get("uptime_seconds")

            return AgentStatus(
                agent_id=self.agent_id,
                agent_type=self.agent_type,
                name=self.display_name,
                status="online" if online else "offline",
                model=model,
                session_count=session_count,
                uptime_seconds=uptime,
                last_active=datetime.now(timezone.utc) if online else None,
            )

        return await self._cb_health.call(_health_impl)

    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]:
        async def _sessions_impl() -> list[AgentSession]:
            sessions: list[AgentSession] = []
            try:
                if not SESSIONS_DIR.is_dir():
                    return sessions
                files = sorted(SESSIONS_DIR.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
                for path in files[:limit]:
                    first_line = path.read_text(encoding="utf-8").splitlines()[0]
                    if not first_line:
                        continue
                    try:
                        msg = json.loads(first_line)
                    except json.JSONDecodeError:
                        continue
                    ts_raw = msg.get("timestamp") or path.name[:15]
                    try:
                        ts = datetime.strptime(ts_raw, "%Y%m%d_%H%M%S").replace(tzinfo=timezone.utc)
                    except (ValueError, TypeError):
                        ts = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
                    content = msg.get("content", "")
                    title = (content[:50] + "...") if len(content) > 50 else content
                    sessions.append(
                        AgentSession(
                            id=path.stem,
                            agent_id=self.agent_id,
                            title=title or "(untitled)",
                            preview=content[:200],
                            last_active=ts,
                            body=content,
                            author="ARETE",
                        )
                    )
            except Exception as exc:
                self._record_error(str(exc), severity="warning")
            return sessions

        return await self._cb_sessions.call(_sessions_impl)

    async def recent_errors(self, limit: int = 10) -> list[AgentError]:
        """Return the N most recent errors from the in-memory buffer."""
        return list(self._last_errors[-limit:])

    async def list_skills(self) -> list[dict]:
        async def _skills_impl() -> list[dict]:
            skills: list[dict] = []
            seen_names: set[str] = set()
            try:
                if not SKILLS_DIR.is_dir():
                    return skills
                # Recursively scan: top-level dirs may be skill dirs or category dirs
                for entry in sorted(SKILLS_DIR.iterdir()):
                    if entry.is_dir():
                        # If the dir has a SKILL.md, it's a skill
                        sk = self._parse_skill_dir(entry)
                        if sk and sk["name"] not in seen_names:
                            skills.append(sk)
                            seen_names.add(sk["name"])
                        elif not sk:
                            # No SKILL.md — treat as a category and scan children
                            for child in sorted(entry.iterdir()):
                                if child.is_dir():
                                    csk = self._parse_skill_dir(child)
                                    if csk and csk["name"] not in seen_names:
                                        csk["category"] = csk.get("category") or entry.name.replace("-", " ").title()
                                        skills.append(csk)
                                        seen_names.add(csk["name"])
                                elif child.suffix == ".md" and child.name != "README.md":
                                    csk = self._parse_skill_file(child)
                                    if csk and csk["name"] not in seen_names:
                                        csk["category"] = csk.get("category") or entry.name.replace("-", " ").title()
                                        skills.append(csk)
                                        seen_names.add(csk["name"])
                    elif entry.suffix == ".md" and entry.name != "README.md":
                        sk = self._parse_skill_file(entry)
                        if sk and sk["name"] not in seen_names:
                            skills.append(sk)
                            seen_names.add(sk["name"])
            except Exception as exc:
                self._record_error(str(exc), severity="warning")
            return skills

        return await self._cb_skills.call(_skills_impl)

    def _parse_skill_dir(self, path: Path) -> dict | None:
        """Parse a skill directory (e.g. ~/.hermes/skills/deep-reasoning/SKILL.md)."""
        skill_md = path / "SKILL.md"
        if not skill_md.is_file():
            return None
        return self._parse_skill_file(skill_md)

    def _parse_skill_file(self, path: Path) -> dict | None:
        """Parse YAML frontmatter from a SKILL.md file."""
        try:
            text = path.read_text(encoding="utf-8")
        except Exception:
            return None
        name = path.stem if path.name != "SKILL.md" else path.parent.name
        category: str | None = None
        source = "local"
        trust = "unknown"
        enabled = True

        if text.startswith("---"):
            try:
                end = text.find("---", 3)
                if end != -1:
                    import yaml
                    front = yaml.safe_load(text[3:end])
                    if isinstance(front, dict):
                        name = front.get("name", name)
                        category = front.get("category")
                        source = front.get("source", "local")
                        trust = front.get("trust", "unknown")
                        enabled = front.get("enabled", True)
            except Exception:
                pass

        return {
            "name": name,
            "category": category,
            "source": source,
            "trust": trust,
            "enabled": enabled,
        }

    async def list_cron_jobs(self) -> list[dict]:
        async def _cron_impl() -> list[dict]:
            try:
                data = await self._get("/api/jobs")
            except Exception as exc:
                self._record_error(str(exc), severity="warning")
                return []

            raw_jobs = data if isinstance(data, list) else data.get("jobs", [])
            jobs: list[dict] = []
            for item in raw_jobs:
                if not isinstance(item, dict):
                    continue
                # Transform api_server job format to dashboard format
                schedule = item.get("schedule", "")
                # Hermes API may return schedule as a dict {"kind": "cron", "expr": "...", "display": "..."}
                if isinstance(schedule, dict):
                    schedule = schedule.get("expr") or schedule.get("display") or ""
                if not schedule and item.get("trigger") == "cron":
                    schedule = item.get("trigger_args", "")
                jobs.append(
                    {
                        "id": item.get("id", ""),
                        "status": "active" if not item.get("paused") else "paused",
                        "name": item.get("name", ""),
                        "schedule": schedule,
                        "next_run": item.get("next_run_at") or item.get("next_run", ""),
                        "last_run": item.get("last_run_at") or item.get("last_run", ""),
                        "last_status": item.get("last_status", ""),
                    }
                )
            return jobs

        return await self._cb_cron.call(_cron_impl)

    async def dispatch(self, task: str, skills: str | None = None) -> dict[str, Any]:
        """Send a task to ARETE via POST /v1/chat/completions."""
        async def _dispatch_impl() -> dict[str, Any]:
            system_msg = "You are ARETE, an elite software engineering AI."
            if skills:
                system_msg += f" Use the skill '{skills}' if relevant."
            payload = {
                "model": "hermes-agent",
                "messages": [
                    {"role": "system", "content": system_msg},
                    {"role": "user", "content": task},
                ],
            }
            try:
                data = await self._post("/v1/chat/completions", json=payload)
                choice = data.get("choices", [{}])[0]
                response_text = choice.get("message", {}).get("content", "")
                return {
                    "agent": "arete",
                    "task": task,
                    "session_id": data.get("id", ""),
                    "response": response_text[:500],
                    "success": True,
                    "error": None,
                }
            except AgentOfflineError:
                return {
                    "agent": "arete",
                    "task": task,
                    "success": False,
                    "error": "Hermes API unreachable",
                }
            except Exception as exc:
                return {
                    "agent": "arete",
                    "task": task,
                    "success": False,
                    "error": str(exc)[:200],
                }

        return await self._cb_dispatch.call(_dispatch_impl)
