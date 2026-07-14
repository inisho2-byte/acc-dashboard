"""ARETE chat engine — sends messages via the Hermes CLI subprocess.

Spawns `hermes chat -Q -q "<message>"` with --max-turns 1,
captures stdout/stderr. Enforces single-request concurrency
with an asyncio.Lock so only one Hermes invocation runs at a time.

Hermes CLI flags:
  -Q / --quiet     Quiet mode: suppress banner, spinner, tool previews.
  -q / --query     Single query (non-interactive mode). Takes the message text.
  --max-turns N    Cap on tool-calling iterations.
  -m / --model     Model override.
  --resume ID      Resume a previous session by ID.
  --pass-session-id  Include session ID in system prompt.
"""

from __future__ import annotations

import asyncio
import logging
import re
import signal
import time
import uuid
from asyncio.subprocess import PIPE
from datetime import datetime, timezone

from fastapi import HTTPException

from server.chat.models import ChatResponse
from server.chat.session_store import ChatSessionStore

logger = logging.getLogger("acc-dashboard.chat.arete")

# Pattern to extract a Hermes session UUID from CLI output
_SESSION_UUID_RE = re.compile(
    r"session_id[:\\s]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})",
    re.IGNORECASE,
)


class AreteChatEngine:
    """Async chat engine that drives the Hermes CLI (`hermes chat`).

    Only one request may be active at a time. Concurrent callers receive
    HTTP 409. Supports cancellation via SIGTERM/SIGKILL.
    """

    def __init__(self, session_store: ChatSessionStore) -> None:
        self._store = session_store
        self._lock = asyncio.Lock()
        self._current_proc: asyncio.subprocess.Process | None = None

    async def send(
        self,
        message: str,
        session_id: str | None = None,
        model: str | None = None,
    ) -> ChatResponse:
        """Send a message to ARETE via the Hermes CLI and return the response.

        Args:
            message: User message text.
            session_id: Optional existing session ID to resume.
            model: Optional model override (passed via -m).

        Returns:
            ChatResponse with the assistant's reply.

        Raises:
            HTTPException: 409 if already processing, 504 on timeout.
        """
        # Reject if a request is already in-flight
        if self._lock.locked():
            raise HTTPException(status_code=409, detail="ARETE is already processing")

        async with self._lock:
            # ── Resolve or create session ──────────────────────────────
            session: dict | None = None
            if session_id:
                session = self._store.get_session(session_id)
            if session is None:
                session = self._store.get_active_session("arete")
            if session is None:
                session = self._store.create_session(agent="arete", model=model or "")

            sid = session["id"]

            # ── Build CLI arguments ────────────────────────────────────
            #   -Q = quiet mode (suppress banner, spinner, tool previews)
            #   -q = query mode (non-interactive, message as argument)
            #   --max-turns 1 = single exchange
            args: list[str] = [
                "hermes", "chat",
                "-Q",
                "-q", message,
                "--max-turns", "1",
                "--pass-session-id",
            ]
            if session.get("external_id"):
                args.extend(["--resume", session["external_id"]])
            if model:
                args.extend(["-m", model])

            # ── Spawn subprocess ───────────────────────────────────────
            start = time.monotonic()
            try:
                proc = await asyncio.create_subprocess_exec(
                    *args,
                    stdin=PIPE,  # needed for graceful EOF but we close immediately
                    stdout=PIPE,
                    stderr=PIPE,
                )
                self._current_proc = proc

                # Close stdin immediately — Hermes reads the query from -q,
                # not from stdin. Closing stdin signals "no more input" so
                # the process doesn't hang waiting for interactive input.
                proc.stdin.close()
                # StreamWriter.close() is NOT a coroutine — do not await it.
                # Call drain() to flush the write buffer before closing.
                try:
                    await proc.stdin.drain()
                except Exception:
                    pass  # drain may fail if process already exited

                # Wait for completion with a 180s timeout
                stdout_bytes, stderr_bytes = await asyncio.wait_for(
                    proc.communicate(),
                    timeout=180,
                )
            except asyncio.TimeoutError:
                # Terminate the hung process
                if self._current_proc and self._current_proc.returncode is None:
                    self._current_proc.terminate()
                    try:
                        await asyncio.wait_for(
                            self._current_proc.wait(), timeout=2
                        )
                    except asyncio.TimeoutError:
                        self._current_proc.kill()
                self._current_proc = None
                raise HTTPException(
                    status_code=504,
                    detail="ARETE request timed out after 180s",
                )
            except Exception as exc:
                self._current_proc = None
                logger.exception("ARETE subprocess error")
                return ChatResponse(success=False, error=str(exc), session_id=sid)
            finally:
                self._current_proc = None

            elapsed_ms = int((time.monotonic() - start) * 1000)
            stdout = stdout_bytes.decode("utf-8", errors="replace").strip()
            stderr = stderr_bytes.decode("utf-8", errors="replace").strip()

            # ── Handle non-zero exit ───────────────────────────────────
            if proc.returncode != 0:
                error_msg = stderr or f"hermes exited with code {proc.returncode}"
                logger.error("ARETE error: %s", error_msg)
                self._store.add_message(sid, "user", message)
                self._store.add_message(sid, "assistant", "", metadata=error_msg)
                return ChatResponse(
                    success=False,
                    error=error_msg,
                    session_id=sid,
                    duration_ms=elapsed_ms,
                )

            # ── Extract Hermes session ID from output ──────────────────
            ext_id_match = _SESSION_UUID_RE.search(stdout)
            if ext_id_match:
                self._store.update_session(
                    sid, external_id=ext_id_match.group(1),
                )

            # ── Persist messages and update session ────────────────────
            self._store.add_message(sid, "user", message)
            new_turns = session.get("turns", 0) + 1
            self._store.add_message(sid, "assistant", stdout)
            self._store.update_session(sid, turns=new_turns)

            return ChatResponse(
                success=True,
                response=stdout,
                session_id=sid,
                turns=new_turns,
                duration_ms=elapsed_ms,
            )

    async def cancel(self) -> bool:
        """Cancel the currently running ARETE subprocess.

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
                logger.warning("ARETE process required SIGKILL")
            return True
        except ProcessLookupError:
            # Process already exited between check and signal
            return False
        finally:
            self._current_proc = None
