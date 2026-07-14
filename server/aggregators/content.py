"""Content library endpoints for the ACC Dashboard.

Reads and writes .md files from ~/.hermes/content/<agent>/ directories.
Each file is a markdown document owned by an agent (scout, scribe, reach, dev).

Path validation ensures no traversal attacks — all paths must resolve under
the content root directory.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

CONTENT_ROOT = Path.home() / ".hermes" / "content"


def _safe_path(path: str) -> Path | None:
    """Validate and resolve a path under CONTENT_ROOT. Returns None if invalid."""
    try:
        target = (CONTENT_ROOT / path).resolve()
        if not str(target).startswith(str(CONTENT_ROOT.resolve())):
            return None
        return target
    except (ValueError, OSError):
        return None


def _extract_title(content: str) -> str:
    """Extract the first H1 heading from markdown content."""
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("# ") and not stripped.startswith("## "):
            return stripped[2:].strip()
    return ""


def list_content() -> list[dict[str, Any]]:
    """Return all .md files in the content directory, grouped by agent."""
    results = []
    if not CONTENT_ROOT.is_dir():
        return results

    for agent_dir in sorted(CONTENT_ROOT.iterdir()):
        if not agent_dir.is_dir():
            continue
        agent = agent_dir.name
        for md_file in sorted(agent_dir.glob("*.md")):
            rel_path = f"{agent}/{md_file.name}"
            try:
                content = md_file.read_text(encoding="utf-8")
                title = _extract_title(content) or md_file.stem.replace("-", " ").title()
            except (OSError, UnicodeDecodeError):
                title = md_file.stem.replace("-", " ").title()
            stat = md_file.stat()
            results.append({
                "agent": agent,
                "filename": md_file.name,
                "path": rel_path,
                "title": title,
                "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                "size": stat.st_size,
            })
    return results


def get_content(path: str) -> dict[str, Any] | None:
    """Get a single file's content. Returns None if path is invalid or file missing."""
    safe = _safe_path(path)
    if safe is None or not safe.is_file():
        return None
    try:
        content = safe.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None
    stat = safe.stat()
    return {
        "path": path,
        "content": content,
        "title": _extract_title(content) or safe.stem.replace("-", " ").title(),
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "size": stat.st_size,
    }


def save_content(path: str, content: str) -> dict[str, Any] | None:
    """Write content to a file. Returns metadata or None if path is invalid."""
    safe = _safe_path(path)
    if safe is None:
        return None
    # Ensure parent directory exists
    safe.parent.mkdir(parents=True, exist_ok=True)
    safe.write_text(content, encoding="utf-8")
    stat = safe.stat()
    return {
        "path": path,
        "title": _extract_title(content) or safe.stem.replace("-", " ").title(),
        "modified_at": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
        "size": stat.st_size,
    }