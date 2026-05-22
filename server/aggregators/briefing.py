from __future__ import annotations

from datetime import datetime, timedelta, timezone

from server.aggregators.activity_engine import ActivityEngine
from server.vault import VaultReader


class BriefingGenerator:
    """Generates 'Since you last checked' daily briefings."""

    def __init__(
        self,
        activity: ActivityEngine,
        vault: VaultReader,
    ) -> None:
        self._activity = activity
        self._vault = vault

    async def generate(self, hours: int = 24, since: datetime | None = None) -> dict:
        """Generate a structured briefing."""
        if since is None:
            since = datetime.now(timezone.utc) - timedelta(hours=hours)

        events = await self._activity.get_timeline(limit=200, since=since)

        # Categorize events
        arete_sessions = [e for e in events if e.agent_id == "arete" and e.event_type == "session"]
        shu_messages = [e for e in events if e.agent_id == "shu" and e.event_type == "message"]
        cron_events = [e for e in events if e.event_type == "cron"]
        errors = [e for e in events if e.event_type == "error"]

        # Project status from vault
        projects = self._vault.get_all_projects()

        # Generate natural-language narrative summary (A3)
        summary_data = {
            "total_events": len(events),
            "arete_sessions": len(arete_sessions),
            "shu_messages": len(shu_messages),
            "cron_jobs_run": len(cron_events),
            "errors": len(errors),
        }

        recent_sessions_list = [
            {"title": e.summary, "timestamp": e.timestamp.isoformat()}
            for e in arete_sessions[:5]
        ]

        def generate_narrative() -> str:
            """Turn structured briefing data into a 2-3 sentence summary."""
            s = summary_data
            parts = [
                f"In the last {hours or 'N/A'}h: {s['arete_sessions']} ARETE sessions, "
                f"{s['shu_messages']} Shu messages, {s['cron_jobs_run']} cron jobs."
            ]
            if s["errors"] > 0:
                parts.append(f" {s['errors']} errors detected.")
            else:
                parts.append(" No errors detected.")
            top_session = recent_sessions_list[0]["title"] if recent_sessions_list else None
            if top_session:
                parts.append(f" Top session: {top_session}.")
            return "".join(parts)

        return {
            "since_hours": hours,
            "since_timestamp": since.isoformat() if since else None,
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "narrative": generate_narrative(),
            "summary": summary_data,
            "recent_sessions": recent_sessions_list,
            "recent_messages": [
                {"preview": e.summary[:80], "timestamp": e.timestamp.isoformat()}
                for e in shu_messages[:5]
            ],
            "recent_cron": [
                {"name": e.summary, "timestamp": e.timestamp.isoformat()}
                for e in cron_events[:5]
            ],
            "projects": [
                {
                    "name": p.name,
                    "status": p.status,
                    "phases": f"{p.phases_complete}/{p.phase_count}",
                    "next_step": p.next_step,
                }
                for p in projects
            ],
            "errors": [
                {"message": e.summary[:100], "timestamp": e.timestamp.isoformat()}
                for e in errors[:5]
            ],
        }
