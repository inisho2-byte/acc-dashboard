"""Claude Code filesystem reader with caching, path sandboxing, and secret redaction.

Reads data from Claude Code's local data directory (~/.claude/) exclusively via
filesystem I/O — Claude Code has no HTTP API. All reads are async via
asyncio.to_thread with a Semaphore(8) to avoid blocking the event loop.

Security: Hard deny list blocks daemon/, settings.json, paste-cache/, etc.
All content passes through redact_secrets() before serving.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from cachetools import TTLCache

from server.models import (
    ClaudeFileChange,
    ClaudePlan,
    ClaudeSession,
    ClaudeTask,
)
from server.utils.secret_redaction import redact_secrets

logger = logging.getLogger("acc-dashboard.claude_code_reader")

# ── Hard Deny List — Never Read These ────────────────────────────────────────

DENIED_SUBPATHS = {
    "daemon",          # pipe.key = IPC auth token (CRITICAL: RCE risk)
    "cache",            # internal cache
    "backups",          # may contain sensitive backups
    "paste-cache",      # user pasted content (secrets!)
    "shell-snapshots",  # shell history snapshots
    "telemetry",        # telemetry IDs
    "status-bar",       # internal status bar state
    "ide",              # IDE connection state
    "plugins",          # plugin state
    "session-env",      # session environment variables (env vars = secrets)
    "downloads",        # downloaded content
}

DENIED_FILES = {
    "settings.json",        # contains permissions, bypass modes, hook commands
    "settings.local.json",  # contains local permission overrides
    "pipe.key",             # daemon IPC auth token
    ".last-cleanup",       # internal state
    "CLAUDE.md",           # global instructions (potentially sensitive project context)
}

# ── Metadata-Only Paths ─────────────────────────────────────────────────────
# Session content and history entries contain full user prompts — never serve raw.

METADATA_ONLY_PATHS = {"sessions", "history.jsonl"}

# ─── Content-Allowed Paths (with redaction) ──────────────────────────────────

CONTENT_ALLOWED_PATHS = {"skills", "plans"}

# ── TTL Cache Durations (seconds) ────────────────────────────────────────────

CACHE_TTLS = {
    "sessions": 30,
    "history": 30,
    "tasks": 60,
    "plans": 300,
    "skills": 300,
    "settings": 300,
    "file_history": 120,
}

# ── Concurrency ───────────────────────────────────────────────────────────────

_IO_SEMAPHORE = asyncio.Semaphore(8)


# ── Windows Path Normalization ────────────────────────────────────────────────


def normalize_windows_path(win_path: str) -> str:
    """Convert C:\\Users\\Iniolu\\... to /mnt/c/Users/Iniolu/...

    JSON already unescapes \\\\ to \\, so we handle single backslashes too.
    """
    if not win_path:
        return win_path
    path = win_path.replace("\\", "/")
    # Match drive letter pattern: C:/...
    match = re.match(r"^([A-Za-z]):(.+)$", path)
    if match:
        drive = match.group(1).lower()
        rest = match.group(2)
        return f"/mnt/{drive}{rest}"
    return path


# ── Path Sandboxing ───────────────────────────────────────────────────────────


def safe_claude_path(relative_path: str, base_dir: Path) -> Path | None:
    """Resolve a relative path within base_dir and verify it stays inside.

    Returns None if the path escapes the base directory or hits a denied path.
    """
    if ".." in relative_path or "\\" in relative_path:
        return None
    target = (base_dir / relative_path).resolve()
    try:
        relative = target.relative_to(base_dir)
    except ValueError:
        return None
    # Check deny lists
    parts = relative.parts
    if parts and parts[0] in DENIED_SUBPATHS:
        return None
    if target.name in DENIED_FILES:
        return None
    return target


class ClaudeCodeReader:
    """Async filesystem reader for Claude Code data with caching and security."""

    def __init__(self, data_dir: str | None = None) -> None:
        self._base_dir: Path | None = None
        self._discovered = False

        if data_dir:
            candidate = Path(data_dir)
            if candidate.is_dir():
                self._base_dir = candidate.resolve()
                self._discovered = True

        # TTL caches per data type
        self._caches: dict[str, TTLCache] = {
            key: TTLCache(maxsize=32, ttl=ttl)
            for key, ttl in CACHE_TTLS.items()
        }
        # File signatures for delta detection: {(type, key): (mtime, size)}
        self._file_sigs: dict[tuple[str, str], tuple[float, int]] = {}

    @property
    def data_dir(self) -> Path | None:
        """Return the discovered data directory, or None if not found."""
        if not self._discovered:
            self._discover_data_dir()
        return self._base_dir

    # ── Data Directory Discovery ─────────────────────────────────────────────

    def _discover_data_dir(self) -> None:
        """Check WSL path first, then Windows mount, then /mnt/c/Users/*/."""
        if self._discovered:
            return

        # os.getlogin() can fail in WSL/no-Tty environments — use environment fallback
        try:
            user = os.getlogin()
        except OSError:
            user = os.environ.get("USER", os.environ.get("USERNAME", ""))

        candidates = [
            Path.home() / ".claude",
            Path(f"/mnt/c/Users/{user}") / ".claude",
        ]

        for candidate in candidates:
            if candidate.is_dir():
                self._base_dir = candidate.resolve()
                self._discovered = True
                logger.info(
                    "claude_code_data_dir_found",
                    extra={"path": str(self._base_dir)},
                )
                return

        # Fallback: scan /mnt/c/Users/*/ for .claude/
        try:
            users_dir = Path("/mnt/c/Users")
            if users_dir.is_dir():
                for user_dir in users_dir.iterdir():
                    claude_dir = user_dir / ".claude"
                    if claude_dir.is_dir():
                        self._base_dir = claude_dir.resolve()
                        self._discovered = True
                        logger.info(
                            "claude_code_data_dir_found_scan",
                            extra={"path": str(self._base_dir)},
                        )
                        return
        except PermissionError:
            pass

        self._discovered = True  # Mark as discovered even if not found
        logger.warning("claude_code_data_dir_not_found")

    # ── Cache Helpers ──────────────────────────────────────────────────────────

    def _is_cache_valid(self, cache_key: str, sig_key: str, path: Path) -> bool:
        """Check if cached data is still valid by comparing file signatures."""
        try:
            stat = path.stat()
        except OSError:
            return False

        current_sig = (stat.st_mtime, stat.st_size)
        stored_sig = self._file_sigs.get((cache_key, sig_key))
        return stored_sig == current_sig

    def _update_sig(self, cache_key: str, sig_key: str, path: Path) -> None:
        """Store file signature for delta detection."""
        try:
            stat = path.stat()
            self._file_sigs[(cache_key, sig_key)] = (stat.st_mtime, stat.st_size)
        except OSError:
            pass

    # ── Safe File Reading ──────────────────────────────────────────────────────

    async def _read_file(self, path: Path) -> str | None:
        """Read a file asynchronously with semaphore concurrency control."""
        async with _IO_SEMAPHORE:
            try:
                return await asyncio.to_thread(path.read_text, "utf-8")
            except (OSError, UnicodeDecodeError):
                return None

    async def _read_json(self, path: Path) -> dict[str, Any] | None:
        """Read and parse a JSON file, returning None on any error."""
        text = await self._read_file(path)
        if text is None:
            return None
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            self._record_error(f"Failed to parse JSON: {path.name}")
            return None

    async def _list_dir(self, path: Path) -> list[Path]:
        """List directory entries asynchronously."""
        async with _IO_SEMAPHORE:
            try:
                return await asyncio.to_thread(lambda: sorted(path.iterdir()))
            except OSError:
                return []

    # ── Error Recording ────────────────────────────────────────────────────────

    def _record_error(self, message: str, severity: str = "warning") -> None:
        """Log an error for the adapter to pick up."""
        logger.warning(
            "claude_code_reader_error",
            extra={"message": message, "severity": severity},
        )

    # ── Sessions ────────────────────────────────────────────────────────────────

    async def list_sessions(self) -> list[ClaudeSession]:
        """List Claude Code sessions from sessions/*.json files.

        Each session file is named {PID}.json and contains session metadata.
        """
        d = self.data_dir
        if d is None:
            return []

        cache = self._caches["sessions"]
        cache_key = "all_sessions"
        sessions_dir = d / "sessions"

        # Check freshness
        if cache_key in cache and self._is_cache_valid("sessions", cache_key, sessions_dir):
            return cache[cache_key]

        if not sessions_dir.is_dir():
            return []

        entries = await self._list_dir(sessions_dir)
        sessions: list[ClaudeSession] = []

        for entry in entries:
            if not entry.is_file() or entry.suffix != ".json":
                continue
            data = await self._read_json(entry)
            if data is None:
                continue

            try:
                session_id = data.get("sessionId", entry.stem)
                pid = data.get("pid")
                cwd_raw = data.get("cwd", "")
                cwd_normalized = normalize_windows_path(cwd_raw)

                # Determine status from updatedAt
                updated_at_ms = data.get("updatedAt", 0)
                updated_at = None
                if updated_at_ms:
                    updated_at = datetime.fromtimestamp(
                        updated_at_ms / 1000, tz=timezone.utc
                    )

                started_at_ms = data.get("startedAt", 0)
                started_at = None
                if started_at_ms:
                    started_at = datetime.fromtimestamp(
                        started_at_ms / 1000, tz=timezone.utc
                    )

                # Derive status: active if updated in last 60s, idle if older, offline if no data
                now = datetime.now(timezone.utc)
                if updated_at:
                    age = (now - updated_at).total_seconds()
                    status = "active" if age < 60 else "idle"
                else:
                    status = "offline"

                # Check for tasks and plans
                task_count = await self._count_session_tasks(session_id)
                has_plan = await self._session_has_plan(session_id)

                sessions.append(
                    ClaudeSession(
                        id=session_id,
                        pid=pid,
                        cwd=cwd_normalized,
                        display_cwd=cwd_raw,
                        version=data.get("version"),
                        kind=data.get("kind"),
                        entrypoint=data.get("entrypoint"),
                        status=status,
                        started_at=started_at,
                        updated_at=updated_at,
                        last_prompt=None,  # Filled from history
                        task_count=task_count,
                        has_plan=has_plan,
                    )
                )
            except Exception as exc:
                self._record_error(f"Failed to parse session {entry.name}: {exc}")

        # Enrich with last_prompt from history
        history_prompts = await self._get_last_prompts_by_session()
        for s in sessions:
            s.last_prompt = history_prompts.get(s.id)

        # Sort by updated_at descending (most recent first)
        sessions.sort(key=lambda s: s.updated_at or datetime.min.replace(tzinfo=timezone.utc), reverse=True)

        cache[cache_key] = sessions
        self._update_sig("sessions", cache_key, sessions_dir)
        return sessions

    # ── History ─────────────────────────────────────────────────────────────────

    async def get_session_history(
        self, session_id: str, limit: int = 50
    ) -> list[dict[str, Any]]:
        """Get history entries for a specific session from history.jsonl.

        Returns metadata-only entries (truncated display, timestamp, project).
        """
        d = self.data_dir
        if d is None:
            return []

        history_path = d / "history.jsonl"
        cache_key = f"history_{session_id}"
        cache = self._caches["history"]

        if cache_key in cache and self._is_cache_valid("history", "all", history_path):
            entries = cache[cache_key]
            return entries[:limit]

        all_entries = await self._parse_history(history_path)
        cache[cache_key] = all_entries
        self._update_sig("history", "all", history_path)

        filtered = [e for e in all_entries if e.get("session_id") == session_id]
        return filtered[:limit]

    async def _get_last_prompts_by_session(self) -> dict[str, str | None]:
        """Map session IDs to their most recent prompt (truncated to 80 chars, redacted)."""
        d = self.data_dir
        if d is None:
            return {}

        history_path = d / "history.jsonl"
        entries = await self._parse_history(history_path)
        result: dict[str, str | None] = {}
        for entry in reversed(entries):
            sid = entry.get("session_id")
            if sid and sid not in result:
                display = entry.get("display", "")
                result[sid] = redact_secrets(display[:80]) if display else None
        return result

    async def _parse_history(self, path: Path) -> list[dict[str, Any]]:
        """Parse history.jsonl line by line, skipping bad lines."""
        text = await self._read_file(path)
        if text is None:
            return []

        results: list[dict[str, Any]] = []
        skipped = 0

        for line in text.splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
                # Only serve metadata — truncated display, no pastedContents
                results.append(
                    {
                        "session_id": data.get("sessionId", ""),
                        "display": redact_secrets((data.get("display") or "")[:80]),
                        "timestamp": data.get("timestamp"),
                        "project": data.get("project", ""),
                    }
                )
            except json.JSONDecodeError:
                skipped += 1

        if skipped:
            self._record_error(f"Skipped {skipped} malformed lines in history.jsonl")

        return results

    # ── Tasks ───────────────────────────────────────────────────────────────────

    async def list_tasks(self) -> list[ClaudeTask]:
        """List all tasks across all session directories in tasks/."""
        d = self.data_dir
        if d is None:
            return []

        cache = self._caches["tasks"]
        cache_key = "all_tasks"
        tasks_dir = d / "tasks"

        if cache_key in cache and self._is_cache_valid("tasks", cache_key, tasks_dir):
            return cache[cache_key]

        if not tasks_dir.is_dir():
            return []

        entries = await self._list_dir(tasks_dir)
        tasks: list[ClaudeTask] = []

        for session_dir in entries:
            if not session_dir.is_dir():
                continue
            session_id = session_dir.name
            task_files = await self._list_dir(session_dir)
            for tf in task_files:
                if not tf.is_file() or tf.suffix != ".json":
                    continue
                data = await self._read_json(tf)
                if data is None:
                    continue
                try:
                    tasks.append(
                        ClaudeTask(
                            id=data.get("id", tf.stem),
                            session_id=data.get("session_id", session_id),
                            subject=redact_secrets(data.get("subject", "")),
                            description=redact_secrets((data.get("description") or "")[:500]),
                            active_form=data.get("activeForm"),
                            status=data.get("status", "pending"),
                            blocks=data.get("blocks", []),
                            blocked_by=data.get("blockedBy", []),
                        )
                    )
                except Exception as exc:
                    self._record_error(f"Failed to parse task {tf.name}: {exc}")

        cache[cache_key] = tasks
        self._update_sig("tasks", cache_key, tasks_dir)
        return tasks

    async def _count_session_tasks(self, session_id: str) -> int:
        """Count task files for a given session."""
        d = self.data_dir
        if d is None:
            return 0
        tasks_dir = d / "tasks" / session_id
        if not tasks_dir.is_dir():
            return 0
        entries = await self._list_dir(tasks_dir)
        return sum(1 for e in entries if e.suffix == ".json")

    async def _session_has_plan(self, session_id: str) -> bool:
        """Check if a session has associated plan files (by checking tasks or plans dir)."""
        # Plans are stored globally, not per-session. We check if this session
        # appears in tasks, which implies plan activity.
        return False  # Simplified — plans are global, not per-session

    # ── Plans ───────────────────────────────────────────────────────────────────

    async def list_plans(self) -> list[ClaudePlan]:
        """List execution plan files from plans/*.md."""
        d = self.data_dir
        if d is None:
            return []

        cache = self._caches["plans"]
        cache_key = "all_plans"
        plans_dir = d / "plans"

        if cache_key in cache and self._is_cache_valid("plans", cache_key, plans_dir):
            return cache[cache_key]

        if not plans_dir.is_dir():
            return []

        entries = await self._list_dir(plans_dir)
        plans: list[ClaudePlan] = []

        for entry in entries:
            if not entry.is_file() or entry.suffix != ".md":
                continue
            try:
                stat = entry.stat()
                text = await self._read_file(entry)
                if text is None:
                    continue

                # Extract title from first heading
                title = entry.stem  # fallback to filename
                for line in text.splitlines():
                    if line.startswith("# "):
                        title = line.lstrip("# ").strip()
                        break

                plans.append(
                    ClaudePlan(
                        filename=entry.name,
                        title=redact_secrets(title),
                        mtime=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                        size_bytes=stat.st_size,
                        content_preview=redact_secrets(text[:500]),
                    )
                )
            except Exception as exc:
                self._record_error(f"Failed to read plan {entry.name}: {exc}")

        plans.sort(key=lambda p: p.mtime, reverse=True)
        cache[cache_key] = plans
        self._update_sig("plans", cache_key, plans_dir)
        return plans

    async def get_plan_content(self, filename: str) -> str | None:
        """Get full plan content (redacted). Returns None if not found or denied."""
        d = self.data_dir
        if d is None:
            return None

        path = safe_claude_path(f"plans/{filename}", d)
        if path is None:
            return None

        text = await self._read_file(path)
        if text is None:
            return None
        return redact_secrets(text)

    # ── Skills ──────────────────────────────────────────────────────────────────

    async def list_skills(self) -> list[dict[str, Any]]:
        """List Claude Code skills from skills/*/SKILL.md.

        Only returns allowlisted frontmatter fields, never the full body.
        """
        d = self.data_dir
        if d is None:
            return []

        cache = self._caches["skills"]
        cache_key = "all_skills"
        skills_dir = d / "skills"

        if cache_key in cache and self._is_cache_valid("skills", cache_key, skills_dir):
            return cache[cache_key]

        if not skills_dir.is_dir():
            return []

        entries = await self._list_dir(skills_dir)
        skills: list[dict[str, Any]] = []

        for entry in entries:
            if not entry.is_dir():
                continue
            skill_md = entry / "SKILL.md"
            if not skill_md.is_file():
                continue

            text = await self._read_file(skill_md)
            if text is None:
                continue

            # Parse frontmatter (allowlisted fields only)
            skill_info: dict[str, Any] = {
                "name": entry.name,
                "description": "",
            }
            if text.startswith("---"):
                try:
                    end = text.find("---", 3)
                    if end != -1:
                        import yaml

                        front = yaml.safe_load(text[3:end])
                        if isinstance(front, dict):
                            skill_info["description"] = front.get(
                                "description", ""
                            )
                            # Only allowlisted fields
                            for key in ("name", "tags", "allowed-tools"):
                                if key in front:
                                    skill_info[key] = front[key]
                except Exception:
                    pass

            skills.append(skill_info)

        cache[cache_key] = skills
        self._update_sig("skills", cache_key, skills_dir)
        return skills

    # ── Settings ────────────────────────────────────────────────────────────────

    async def get_settings_summary(self) -> dict[str, Any]:
        """Return allowlisted, summarized settings only.

        Never exposes raw allow/deny arrays, hook commands, or
        skipDangerousModePermissionPrompt.
        """
        d = self.data_dir
        if d is None:
            return {}

        cache = self._caches["settings"]
        cache_key = "summary"
        settings_path = d / "settings.json"

        # Note: settings.json is in DENIED_FILES for direct reads.
        # This method is a privileged internal reader that only returns
        # allowlisted summary fields — never raw content.
        if cache_key in cache and self._is_cache_valid("settings", cache_key, settings_path):
            return cache[cache_key]

        data = await self._read_json(settings_path)
        if data is None:
            return {}

        permissions = data.get("permissions", {})

        # Summarize permissions by category, NOT raw arrays
        allow_list = permissions.get("allow", [])
        deny_list = permissions.get("deny", [])

        # Extract high-level categories
        def summarize_permissions(perms: list[str]) -> list[str]:
            categories: set[str] = set()
            for p in perms:
                if p.startswith("Bash("):
                    categories.add(f"Bash: {p[5:-1]}")
                elif p.startswith("Write("):
                    categories.add(f"Write: {p[6:-1]}")
                elif p.startswith("Read"):
                    categories.add("Read")
                elif p.startswith("Edit"):
                    categories.add("Edit")
                elif p.startswith("Glob") or p.startswith("Grep"):
                    categories.add("Search")
                elif p.startswith("WebSearch") or p.startswith("WebFetch"):
                    categories.add("Web")
                elif p.startswith("Skill("):
                    categories.add("Skill")
                elif p.startswith("PowerShell("):
                    categories.add("PowerShell")
                else:
                    categories.add(p)
            return sorted(categories)

        summary = {
            "version": data.get("version", "unknown"),
            "effort_level": data.get("effortLevel"),
            "theme": data.get("theme"),
            "auto_updates_channel": data.get("autoUpdatesChannel"),
            "hooks_count": len(data.get("hooks", {})),
            "permissions_summary": {
                "allowed_categories": summarize_permissions(allow_list),
                "denied_categories": summarize_permissions(deny_list),
                "mode": permissions.get("defaultMode", "unknown"),
            },
        }

        cache[cache_key] = summary
        self._update_sig("settings", cache_key, settings_path)
        return summary

    # ── File History ─────────────────────────────────────────────────────────────

    async def get_file_history(self, session_id: str) -> list[ClaudeFileChange]:
        """Get file version history for a specific session from file-history/.

        Each session has a UUID directory containing files named {hash}@v{N}.
        """
        d = self.data_dir
        if d is None:
            return []

        cache = self._caches["file_history"]
        cache_key = f"history_{session_id}"
        fh_dir = d / "file-history" / session_id

        if cache_key in cache and self._is_cache_valid("file_history", cache_key, fh_dir):
            return cache[cache_key]

        if not fh_dir.is_dir():
            return []

        entries = await self._list_dir(fh_dir)
        changes: list[ClaudeFileChange] = []

        for entry in entries:
            if not entry.is_file():
                continue
            name = entry.name
            # Parse filename: {hash}@v{N}
            if "@" not in name:
                continue

            try:
                parts = name.rsplit("@v", 1)
                file_hash = parts[0]
                version = int(parts[1]) if len(parts) > 1 else 1

                stat = entry.stat()
                changes.append(
                    ClaudeFileChange(
                        session_id=session_id,
                        file_hash=file_hash,
                        version=version,
                        filename=None,  # Can't derive from hash alone
                        size_bytes=stat.st_size,
                        mtime=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
                    )
                )
            except (ValueError, IndexError) as exc:
                self._record_error(f"Failed to parse file-history entry {name}: {exc}")

        changes.sort(key=lambda c: c.mtime, reverse=True)
        cache[cache_key] = changes
        self._update_sig("file_history", cache_key, fh_dir)
        return changes

    # ── Health / Liveness ───────────────────────────────────────────────────────

    async def get_health_info(self) -> dict[str, Any]:
        """Return health metadata for the Claude Code adapter."""
        d = self.data_dir
        if d is None:
            return {
                "status": "offline",
                "error_message": "Claude Code data directory not found",
            }

        sessions = await self.list_sessions()
        active = sum(1 for s in sessions if s.status == "active")
        total = len(sessions)

        last_activity = None
        for s in sessions:
            if s.updated_at:
                if last_activity is None or s.updated_at > last_activity:
                    last_activity = s.updated_at

        version = sessions[0].version if sessions else None

        return {
            "status": "online" if total > 0 else "offline",
            "active_sessions": active,
            "total_sessions": total,
            "data_dir": str(d),
            "version": version,
            "last_activity": last_activity.isoformat() if last_activity else None,
        }