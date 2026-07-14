"""Claude Code chat engine — drives claude.exe with streaming JSON output.

Spawns the Claude Code CLI with --output-format stream-json, reads
line-by-line JSON events, translates them into ChatEvent payloads,
and publishes them through the SSE EventBus for real-time UI updates.
Enforces single-request concurrency with an asyncio.Lock.
"""

from __future__ import annotations

import asyncio
import json
import logging
import signal
import time
from asyncio.subprocess import PIPE
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from server.chat.models import ChatEvent
from server.chat.session_store import ChatSessionStore
from server.events import EventBus

logger = logging.getLogger("acc-dashboard.chat.claude")

# Path to the Claude Code CLI on Windows (via WSL interop)
CLAUDE_EXE_PATH = "/mnt/c/Users/Iniolu/.local/bin/claude.exe"


class ClaudeChatEngine:
    """Async chat engine that drives the Claude Code CLI.

    Reads streaming JSON output line-by-line, translates events to
    ChatEvent instances, and publishes them via the EventBus for SSE
    delivery to the dashboard UI.
    """

    def __init__(
        self,
        session_store: ChatSessionStore,
        event_bus: EventBus,
    ) -> None:
        self._store = session_store
        self._bus = event_bus
        self._lock = asyncio.Lock()
        self._current_proc: asyncio.subprocess.Process | None = None

    async def send(
        self,
        message: str,
        session_id: str | None = None,
        model: str = "sonnet",
        request_id: str = "",
        budget_usd: float = 1.0,
    ) -> dict:
        """Send a message to Claude Code and stream events to the EventBus.

        Args:
            message: User message text (passed as CLI arg — safe with exec).
            session_id: Optional existing session ID to resume.
            model: Claude model name (default "sonnet").
            request_id: Correlation ID for SSE event routing.
            budget_usd: Max budget in USD for the request.

        Returns:
            Dict with success status and request_id.

        Raises:
            HTTPException: 409 if already processing, 504 on timeout.
        """
        if self._lock.locked():
            raise HTTPException(
                status_code=409, detail="Claude is already processing"
            )

        async with self._lock:
            # ── Resolve or create session ──────────────────────────────
            session: dict | None = None
            if session_id:
                session = self._store.get_session(session_id)
            if session is None:
                session = self._store.get_active_session("claude")
            if session is None:
                session = self._store.create_session(
                    agent="claude", model=model,
                )

            sid = session["id"]
            channel = "claude"

            # ── Build CLI arguments ────────────────────────────────────
            # Safe with create_subprocess_exec — message is a single argv
            # entry, no shell interpretation occurs.
            args: list[str] = [
                CLAUDE_EXE_PATH,
                "-p", message,
                "--model", model,
                "--output-format", "stream-json",
                "--max-budget-usd", str(budget_usd),
            ]
            if session.get("external_id"):
                args.extend(["--resume", session["external_id"]])

            # ── Spawn subprocess ───────────────────────────────────────
            start = time.monotonic()
            collected_text: list[str] = []
            final_result: str = ""

            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    stdin=PIPE,
                    stdout=PIPE,
                    stderr=PIPE,
                    cwd="/mnt/c/Users/Iniolu",
                )
                self._current_proc = proc

                # ── Read stdout line-by-line ───────────────────────────
                while True:
                    line_bytes = await asyncio.wait_for(
                        proc.stdout.readline(), timeout=180,
                    )
                    if not line_bytes:
                        break

                    parsed = self._parse_stream_line(line_bytes)
                    if parsed is None:
                        continue

                    event_type = parsed.get("type", "")

                    if event_type == "token":
                        collected_text.append(parsed.get("content", ""))
                        evt = ChatEvent(
                            type="token",
                            channel=channel,
                            request_id=request_id,
                            content=parsed.get("content", ""),
                            session_id=sid,
                        )
                        await self._bus.publish("chat", evt.model_dump())

                    elif event_type == "tool_call":
                        evt = ChatEvent(
                            type="tool_call",
                            channel=channel,
                            request_id=request_id,
                            tool_name=parsed.get("tool_name", ""),
                            tool_input=parsed.get("tool_input", ""),
                            session_id=sid,
                        )
                        await self._bus.publish("chat", evt.model_dump())

                    elif event_type == "tool_result":
                        evt = ChatEvent(
                            type="tool_result",
                            channel=channel,
                            request_id=request_id,
                            tool_output=parsed.get("tool_output", ""),
                            session_id=sid,
                        )
                        await self._bus.publish("chat", evt.model_dump())

                    elif event_type == "done":
                        final_result = parsed.get("content", "")
                        evt = ChatEvent(
                            type="done",
                            channel=channel,
                            request_id=request_id,
                            content=final_result,
                            session_id=sid,
                        )
                        await self._bus.publish("chat", evt.model_dump())

                    elif event_type == "error":
                        evt = ChatEvent(
                            type="error",
                            channel=channel,
                            request_id=request_id,
                            content=parsed.get("content", ""),
                            session_id=sid,
                        )
                        await self._bus.publish("chat", evt.model_dump())

                    # "heartbeat" and "cancelled" are also valid but no
                    # extra action needed here — they're just forwarded.
                    elif event_type in ("heartbeat", "cancelled"):
                        evt = ChatEvent(
                            type=event_type,
                            channel=channel,
                            request_id=request_id,
                            session_id=sid,
                        )
                        await self._bus.publish("chat", evt.model_dump())

                # Wait for process to finish
                await asyncio.wait_for(proc.wait(), timeout=10)

            except asyncio.TimeoutError:
                if self._current_proc and self._current_proc.returncode is None:
                    self._current_proc.terminate()
                    try:
                        await asyncio.wait_for(self._current_proc.wait(), timeout=2)
                    except asyncio.TimeoutError:
                        self._current_proc.kill()
                self._current_proc = None

                evt = ChatEvent(
                    type="error",
                    channel=channel,
                    request_id=request_id,
                    content="Claude request timed out after 180s",
                    session_id=sid,
                )
                await self._bus.publish("chat", evt.model_dump())
                raise HTTPException(
                    status_code=504,
                    detail="Claude request timed out after 180s",
                )

            except Exception as exc:
                self._current_proc = None
                logger.exception("Claude subprocess error")
                evt = ChatEvent(
                    type="error",
                    channel=channel,
                    request_id=request_id,
                    content=str(exc),
                    session_id=sid,
                )
                await self._bus.publish("chat", evt.model_dump())
                return {"success": False, "error": str(exc), "request_id": request_id}

            finally:
                self._current_proc = None

            elapsed_ms = int((time.monotonic() - start) * 1000)

            # ── Persist messages and update session ────────────────────
            self._store.add_message(sid, "user", message)
            assistant_text = final_result or "".join(collected_text)
            self._store.add_message(
                sid, "assistant", assistant_text,
                duration_ms=elapsed_ms,
            )
            new_turns = session.get("turns", 0) + 1
            self._store.update_session(sid, turns=new_turns)

            return {"success": True, "request_id": request_id}

    @staticmethod
    def _parse_stream_line(line: bytes) -> dict | None:
        """Parse a single JSON line from Claude Code's stream-json output.

        Translates Claude's native event format into a normalized dict
        with a "type" field matching our ChatEvent type vocabulary.

        Args:
            line: Raw bytes from stdout.

        Returns:
            Normalized event dict, or None if the line is not parseable.
        """
        text = line.strip()
        if not text:
            return None

        try:
            obj = json.loads(text)
        except (json.JSONDecodeError, ValueError):
            logger.debug("Skipping non-JSON line: %s", text[:120])
            return None

        event_type = obj.get("type", "")

        # Assistant text token
        if event_type == "assistant" and obj.get("subtype") == "text":
            return {"type": "token", "content": obj.get("content", "")}

        # Tool invocation
        if event_type == "tool_use":
            return {
                "type": "tool_call",
                "tool_name": obj.get("name", ""),
                "tool_input": (
                    json.dumps(obj.get("input", {}))
                    if isinstance(obj.get("input"), dict)
                    else str(obj.get("input", ""))
                ),
            }

        # Tool result
        if event_type == "tool_result":
            return {
                "type": "tool_result",
                "tool_output": obj.get("output", ""),
            }

        # Final result
        if event_type == "result":
            subtype = obj.get("subtype", "")
            if subtype == "success":
                return {"type": "done", "content": obj.get("result", "")}
            # error / other subtypes
            return {
                "type": "error",
                "content": obj.get("result", "") or obj.get("error", str(obj)),
            }

        # Unknown types — log and skip
        logger.debug("Unknown Claude stream type: %s", event_type)
        return None

    async def cancel(self) -> bool:
        """Cancel the currently running Claude subprocess.

        Sends SIGTERM, waits 0.5s, then SIGKILL if still alive.

        Returns:
            True if a process was killed, False if no process was running.
        """
        proc = self._current_proc
        if proc is None or proc.returncode is not None:
            return False

        try:
            proc.send_signal(signal.SIGTERM)
            try:
                await asyncio.wait_for(proc.wait(), timeout=0.5)
            except asyncio.TimeoutError:
                proc.kill()
                logger.warning("Claude process required SIGKILL")
            return True
        except ProcessLookupError:
            return False
        finally:
            self._current_proc = None
