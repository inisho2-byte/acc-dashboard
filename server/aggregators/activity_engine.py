from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from server.agents.hermes_adapter import HermesAdapter
from server.agents.shu_adapter import ShuDiscordAdapter
from server.aggregators.claude_code_reader import ClaudeCodeReader
from server.models import ActivityEvent
from server.vault import VaultReader

class ActivityEngine:
    """Aggregates events from all agents into a unified timeline."""

    def __init__(
        self,
        hermes: HermesAdapter,
        shu: ShuDiscordAdapter,
        vault: VaultReader | None = None,
        claude_reader: ClaudeCodeReader | None = None,
        lookback_hours: int = 24,
    ) -> None:
        self._hermes = hermes
        self._shu = shu
        self._vault = vault
        self._claude_reader = claude_reader
        self._lookback = lookback_hours

    async def get_timeline(
        self,
        limit: int = 50,
        agent_id: str | None = None,
        event_type: str | None = None,
        since: datetime | None = None,
    ) -> list[ActivityEvent]:
        """Build a unified event timeline from all sources."""
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(hours=self._lookback)

        events: list[ActivityEvent] = []

        # 1. Hermes sessions
        arete_sessions = await self._hermes.recent_sessions(limit)
        for s in arete_sessions:
            if s.last_active < since:
                continue
            events.append(
                ActivityEvent(
                    id=f"session-{s.id}",
                    agent_id="arete",
                    event_type="session",
                    timestamp=s.last_active,
                    summary=s.title or "(untitled session)",
                    details={
                        "preview": s.preview,
                        "session_id": s.id,
                    },
                    source="hermes_api",
                )
            )

        # 2. Shu Discord messages
        shu_msgs = await self._shu.recent_sessions(limit)
        for m in shu_msgs:
            if m.last_active < since:
                continue
            events.append(
                ActivityEvent(
                    id=f"shu-msg-{m.id}",
                    agent_id="shu",
                    event_type="message",
                    timestamp=m.last_active,
                    summary=m.preview or "(message)",
                    details={
                        "title": m.title,
                        "msg_id": m.id,
                    },
                    source="discord",
                )
            )

        # 3. Errors from both agents
        for adapter_name, adapter in [("arete", self._hermes), ("shu", self._shu)]:
            errs = await adapter.recent_errors(10)
            for e in errs:
                if e.timestamp < since:
                    continue
                events.append(
                    ActivityEvent(
                        id=f"error-{e.id}",
                        agent_id=e.agent_id,
                        event_type="error",
                        timestamp=e.timestamp,
                        summary=e.message,
                        details={"severity": e.severity},
                        source="hermes_api",
                    )
                )

        # 4. Cron job activity
        cron_errors: list[str] = []
        try:
            cron_jobs = await self._hermes.list_cron_jobs()
            for j in cron_jobs:
                last_run_str = j.get("last_run")
                if last_run_str:
                    try:
                        ts = datetime.fromisoformat(last_run_str)
                    except (ValueError, TypeError):
                        continue
                    if ts < since:
                        continue
                    name = j.get("name", j.get("id", "unknown"))
                    events.append(
                        ActivityEvent(
                            id=f"cron-{j.get('id', name)}",
                            agent_id="arete",
                            event_type="cron",
                            timestamp=ts,
                            summary=f"Cron: {name}",
                            details={
                                "schedule": j.get("schedule", ""),
                                "status": j.get("last_status", ""),
                            },
                            source="cron",
                        )
                    )
        except Exception as exc:
            # Log cron parsing errors instead of silently swallowing
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(f"Failed to parse cron jobs: {exc}")
            cron_errors.append(str(exc))

        # 5. Vault change events (A2)
        if self._vault is not None:
            try:
                vault_changes = self._vault.get_recent_changes(since)
                for vc in vault_changes:
                    events.append(
                        ActivityEvent(
                            id=vc["id"],
                            agent_id="vault",
                            event_type="vault_change",
                            timestamp=vc["timestamp"],
                            summary=vc["summary"],
                            details=vc.get("details"),
                            source="vault",
                        )
                    )
            except Exception as exc:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Failed to get vault changes: {exc}")

        # 6. Claude Code session events
        if self._claude_reader is not None:
            try:
                claude_sessions = await self._claude_reader.list_sessions()
                for cs in claude_sessions:
                    if cs.updated_at and cs.updated_at < since:
                        continue
                    events.append(
                        ActivityEvent(
                            id=f"claude-session-{cs.id}",
                            agent_id="claude-code",
                            event_type="session",
                            timestamp=cs.updated_at or cs.started_at or datetime.now(timezone.utc),
                            summary=f"Claude Code: {cs.display_cwd or cs.cwd}",
                            details={
                                "version": cs.version,
                                "kind": cs.kind,
                                "status": cs.status,
                                "pid": cs.pid,
                                "task_count": cs.task_count,
                            },
                            source="claude_code_fs",
                        )
                    )

                # Claude Code tasks
                claude_tasks = await self._claude_reader.list_tasks()
                for ct in claude_tasks:
                    events.append(
                        ActivityEvent(
                            id=f"claude-task-{ct.id}",
                            agent_id="claude-code",
                            event_type="skill_trigger",
                            timestamp=datetime.now(timezone.utc),
                            summary=f"Task: {ct.subject}",
                            details={
                                "task_id": ct.id,
                                "session_id": ct.session_id,
                                "status": ct.status,
                            },
                            source="claude_code_fs",
                        )
                    )
            except Exception as exc:
                import logging
                logger = logging.getLogger(__name__)
                logger.warning(f"Failed to get Claude Code events: {exc}")

        # Sort by timestamp descending
        events.sort(key=lambda e: e.timestamp, reverse=True)

        # Deduplicate by event ID (A1)
        seen: set[str] = set()
        deduped: list[ActivityEvent] = []
        for e in events:
            if e.id not in seen:
                seen.add(e.id)
                deduped.append(e)
        events = deduped

        # Filter
        if agent_id:
            events = [e for e in events if e.agent_id == agent_id]
        if event_type:
            events = [e for e in events if e.event_type == event_type]

        return events[:limit]
