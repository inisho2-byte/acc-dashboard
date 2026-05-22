from __future__ import annotations

import logging
from pathlib import Path

from server.agents.hermes_adapter import HermesAdapter
from server.agents.shu_adapter import ShuDiscordAdapter

logger = logging.getLogger(__name__)

_MAX_MEMORY_SIZE = 5120  # 5KB cap per memory file


class MemoryReader:
    """Reads each agent's working memory for the Memory Explorer UI."""

    def __init__(
        self,
        hermes: HermesAdapter,
        shu: ShuDiscordAdapter,
    ) -> None:
        self._hermes = hermes
        self._shu = shu

    async def get_arete_memory(self) -> dict:
        """Read Hermes memory files from ~/.hermes/."""
        hermes_dir = Path.home() / ".hermes"
        result: dict = {
            "agent_id": "arete",
            "available": True,
            "sources": {},
        }

        for fname in ("MEMORY.md", "USER.md"):
            fpath = hermes_dir / fname
            if fpath.is_file():
                try:
                    text = fpath.read_text(encoding="utf-8", errors="replace")
                    truncated = len(text) > _MAX_MEMORY_SIZE
                    result["sources"][fname] = {
                        "content": text[:_MAX_MEMORY_SIZE],
                        "size_bytes": len(text),
                        "truncated": truncated,
                    }
                except OSError as exc:
                    result["sources"][fname] = {
                        "content": None,
                        "error": str(exc),
                    }
            else:
                result["sources"][fname] = {
                    "content": None,
                    "error": "File not found",
                }

        if not result["sources"]:
            result["available"] = False

        return result

    async def get_shu_memory(self) -> dict:
        """Return Shu's recent Discord messages as 'memory context'."""
        result: dict = {
            "agent_id": "shu",
            "available": True,
            "sources": {},
        }

        try:
            messages = await self._shu.recent_sessions(10)
            result["sources"]["recent_messages"] = [
                {
                    "id": m.id,
                    "title": m.title,
                    "preview": m.preview,
                    "timestamp": m.last_active.isoformat() if m.last_active else None,
                }
                for m in messages
            ]
        except Exception as exc:
            logger.warning(f"Failed to fetch Shu memory: {exc}")
            result["sources"]["recent_messages"] = []
            result["available"] = False
            result["error"] = str(exc)

        return result
