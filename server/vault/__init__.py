from __future__ import annotations

import hashlib
import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import TypedDict

import frontmatter
import yaml

from server.models import ProjectStatus

logger = logging.getLogger(__name__)

_PROJECTS_REL = "04-projects"


class FileSignature(TypedDict):
    """Cached signature for delta detection."""
    mtime: float
    size: int
    hash: str  # MD5 of first 1KB


class VaultReader:
    """Reads project status from the Obsidian vault.
    
    Uses mtime + content hash for delta detection to handle:
    - WSL filesystem mtime quirks on /mnt/c/
    - Clock skew / mtime manipulation
    - Silent file modifications within cache TTL
    """

    def __init__(self, vault_path: str) -> None:
        self._root = Path(vault_path).resolve()
        self._cache: dict[str, list[ProjectStatus]] = {}
        self._cache_ts: float = 0.0
        self._cache_ttl = 300  # 5 minutes
        self._file_signatures: dict[str, FileSignature] = {}  # path -> signature

    def _validate_path(self, path: Path) -> bool:
        """Ensure resolved path stays within vault root (path traversal protection)."""
        try:
            resolved = path.resolve()
            return resolved.is_relative_to(self._root.resolve())
        except (ValueError, OSError):
            return False

    def _invalidate_if_stale(self) -> None:
        if datetime.now().timestamp() - self._cache_ts > self._cache_ttl:
            self._cache.clear()
            self._file_signatures.clear()  # A5: also clear signatures so next scan redetects changes
            self._cache_ts = 0.0

    @staticmethod
    def _get_file_signature(path: Path) -> FileSignature | None:
        """Get mtime + size + hash of first 1KB for change detection.
        
        Combines multiple signals to handle:
        - WSL /mnt/c/ mtime quirks (NTFS-WSL translation lag)
        - Clock skew / mtime manipulation (touch -d)
        - Size-only changes (hash catches these)
        """
        try:
            stat = path.stat()
            hasher = hashlib.md5()
            with open(path, "rb") as f:
                hasher.update(f.read(1024))
            return FileSignature(
                mtime=stat.st_mtime,
                size=stat.st_size,
                hash=hasher.hexdigest(),
            )
        except (OSError, IOError):
            return None

    def _has_changed(self, path: Path) -> bool:
        """Check if file has changed since last read.
        
        Returns True if:
        - File is new (no cached signature)
        - mtime, size, OR hash differs from cached
        """
        current = self._get_file_signature(path)
        if current is None:
            return False
        
        path_str = str(path)
        previous = self._file_signatures.get(path_str)
        
        if previous is None:
            # New file
            self._file_signatures[path_str] = current
            logger.debug(f"New file detected: {path}")
            return True
        
        # Check all three signals
        changed = (
            current["mtime"] != previous["mtime"] or
            current["size"] != previous["size"] or
            current["hash"] != previous["hash"]
        )
        
        if changed:
            self._file_signatures[path_str] = current
            logger.debug(f"File changed: {path} (mtime: {previous['mtime']:.0f}→{current['mtime']:.0f}, size: {previous['size']}→{current['size']})")
        
        return changed

    def _clear_signature(self, path: Path) -> None:
        """Remove cached signature for deleted file."""
        path_str = str(path)
        if path_str in self._file_signatures:
            del self._file_signatures[path_str]
            logger.debug(f"Cleared signature for deleted file: {path}")

    def get_recent_changes(self, since: datetime) -> list[dict]:
        """Return vault file changes (mtime changes) since the given timestamp.
        
        Returns list of dicts with: id, path, event_type='vault_change', timestamp, summary.
        """
        projects_dir = self._root / _PROJECTS_REL
        if not projects_dir.is_dir():
            return []
        
        changes: list[dict] = []
        for entry in sorted(projects_dir.iterdir()):
            if not entry.is_dir():
                continue
            index_file = self._find_project_file(entry)
            if index_file is None:
                continue
            try:
                mtime = datetime.fromtimestamp(index_file.stat().st_mtime, tz=timezone.utc)
                if mtime >= since:
                    fm = self._parse_frontmatter(index_file)
                    name = fm.get("title", entry.name) if fm else entry.name
                    changes.append({
                        "id": f"vault-{entry.name}",
                        "path": str(index_file.relative_to(self._root)),
                        "event_type": "vault_change",
                        "timestamp": mtime,
                        "summary": f"Vault: {name}",
                        "details": {"project": entry.name, "file": index_file.name},
                    })
            except OSError:
                continue
        
        return changes

    def get_all_projects(self) -> list[ProjectStatus]:
        """Parse all project directories in 04-projects and extract status.
        
        Uses delta detection to avoid unnecessary rescans:
        - Checks file signatures (mtime + size + hash) against cache
        - Only rescans if files have actually changed
        - Handles WSL /mnt/c/ mtime quirks
        """
        self._invalidate_if_stale()
        if self._cache and not self._has_project_dir_changed():
            return list(self._cache.values())[0] if self._cache else []

        projects_dir = self._root / _PROJECTS_REL
        if not projects_dir.is_dir():
            return []

        results: list[ProjectStatus] = []
        for entry in sorted(projects_dir.iterdir()):
            if not entry.is_dir():
                continue
            if not self._validate_path(entry):
                logger.warning(f"Path traversal blocked for entry: {entry}")
                continue
            index_file = self._find_project_file(entry)
            if index_file is None:
                continue

            fm = self._parse_frontmatter(index_file)
            if fm is None:
                continue

            slug = index_file.stem.replace("project-", "", 1).replace("-index", "", 1)
            # Cache file signature for delta detection on subsequent calls
            self._has_changed(index_file)
            phases_total, phases_done = self._scan_phases(entry)

            # Scan docs for next-step / last-action hints
            last_action = self._find_last_action(entry)
            next_step = self._find_next_step(entry)

            results.append(
                ProjectStatus(
                    name=fm.get("title", entry.name),
                    slug=slug,
                    status=fm.get("status", "seed"),
                    phase_count=phases_total,
                    phases_complete=phases_done,
                    tags=fm.get("tags", []),
                    updated=str(fm.get("updated", "") or fm.get("created", "")),
                    path=str(index_file.relative_to(self._root)),
                    last_action=last_action,
                    next_step=next_step,
                )
            )

        self._cache["projects"] = results
        self._cache_ts = datetime.now().timestamp()
        return results

    def _has_project_dir_changed(self) -> bool:
        """Check if any project directory has changed since last scan.
        
        Returns True if:
        - Any project directory is new
        - Any project directory has been deleted
        - Any project's index file has changed
        """
        projects_dir = self._root / _PROJECTS_REL
        if not projects_dir.is_dir():
            return len(self._file_signatures) > 0
        
        current_dirs = set()
        for entry in projects_dir.iterdir():
            if not entry.is_dir():
                continue
            current_dirs.add(str(entry))
            
            index_file = self._find_project_file(entry)
            if index_file and index_file.is_file():
                if self._has_changed(index_file):
                    return True
            elif index_file:
                # File was deleted
                self._clear_signature(index_file)
                return True
        
        # Check for deleted directories
        for cached_path in list(self._file_signatures.keys()):
            if not any(cached_path.startswith(str(d)) for d in current_dirs):
                # File was in a directory that no longer exists or was deleted
                del self._file_signatures[cached_path]
                return True
        
        return False

    def get_entity_count(self) -> int:
        """Count total .md files in the vault."""
        if not self._root.is_dir():
            return 0
        return sum(1 for p in self._root.rglob("*.md") if p.is_file())

    @staticmethod
    def _validate_static_path(path: Path, root: Path) -> bool:
        """Validate that a path stays within the given root (for use in static methods)."""
        try:
            resolved = path.resolve()
            return resolved.is_relative_to(root.resolve())
        except (ValueError, OSError):
            return False

    @staticmethod
    def _scan_phases(directory: Path) -> tuple[int, int]:
        """Count total and completed tasks from the plan doc.

        Uses format-agnostic checkbox counting: counts ALL checkboxes
        (- [ ], - [x], - [X]) as total, and checked ones (- [x], - [X])
        as done. This works across plans that use ### Phase, ### Task,
        ### Phase N Acceptance Criteria, or flat task lists with no
        section headers at all.
        """
        plan_file = None
        for fname in os.listdir(str(directory)):
            if "plan" in fname.lower():
                plan_file = directory / fname
                break
        if not plan_file:
            return 0, 0

        # Validate plan file is within directory (path traversal protection)
        if not VaultReader._validate_static_path(plan_file, directory):
            return 0, 0

        try:
            text = plan_file.read_text(encoding="utf-8")
        except OSError:
            return 0, 0

        # Format-agnostic: count all checkboxes, not just ones inside ### Phase
        total = text.count("- [ ]") + text.count("- [x]") + text.count("- [X]")
        done = text.count("- [x]") + text.count("- [X]")
        return total, done

    @staticmethod
    def _find_last_action(directory: Path) -> str | None:
        """Extract the most recent actionable item from plan task list."""
        plan_file = None
        for fname in os.listdir(str(directory)):
            if "plan" in fname.lower():
                plan_file = directory / fname
                break
        if not plan_file:
            return None

        # A5: Validate plan file stays within directory
        if not VaultReader._validate_static_path(plan_file, directory):
            return None

        try:
            text = plan_file.read_text(encoding="utf-8")
        except OSError:
            return None

        # Find the last completed checkbox description
        for line in reversed(text.splitlines()):
            stripped = line.strip()
            if stripped.startswith("- [x]") or stripped.startswith("- [X]"):
                return stripped[5:].strip()[:80]
        return None

    @staticmethod
    def _find_next_step(directory: Path) -> str | None:
        """Extract the next uncompleted task from the plan."""
        plan_file = None
        for fname in os.listdir(str(directory)):
            if "plan" in fname.lower():
                plan_file = directory / fname
                break
        if not plan_file:
            return None

        # A5: Validate plan file stays within directory
        if not VaultReader._validate_static_path(plan_file, directory):
            return None

        try:
            text = plan_file.read_text(encoding="utf-8")
        except OSError:
            return None

        # Find the first unchecked checkbox
        for line in text.splitlines():
            stripped = line.strip()
            if stripped.startswith("- [ ]"):
                # Skip task-list metadata lines
                content = stripped[5:].strip()
                if content and not content.startswith("<!--"):
                    return content[:80]
        return None

    def _find_project_file(self, directory: Path) -> Path | None:
        """Find the main project index or PRD doc in a project directory."""
        patterns = [
            "project-*-index.md",
            "project-*-prd.md",
            "project-*-plan.md",
            "project-*.md",
        ]
        for pat in patterns:
            matches = sorted(directory.glob(pat))
            for m in matches:
                if m.stat().st_size > 0:
                    return m
        return None

    def _parse_frontmatter(self, path: Path) -> dict | None:
        if not self._validate_path(path):
            logger.warning(f"Path traversal blocked for file: {path}")
            return None
        try:
            if path.stat().st_size == 0:
                return None
            with open(path, encoding="utf-8") as f:
                post = frontmatter.load(f)
            if post.metadata:
                return post.metadata
            # No YAML frontmatter — extract title from first H1
            text = post.content if hasattr(post, "content") else path.read_text(encoding="utf-8")
            for line in text.splitlines():
                line = line.strip()
                if line.startswith("# ") and not line.startswith("##"):
                    title = line[2:].strip()
                    for suffix in [" — PRD", " — Index", " — Architecture", " — Plan", " — AI Rules"]:
                        if title.endswith(suffix):
                            title = title[: -len(suffix)]
                            break
                    return {"title": title}
            return None
        except Exception:  # Catch all exceptions: YAML errors, AttributeError on malformed frontmatter, etc.
            logger.warning(f"Failed to parse frontmatter in {path}", exc_info=True)
            return None
