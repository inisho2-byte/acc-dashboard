"""Vault Analytics — Entity analytics from vault markdown files.

Provides:
  - Entity count and growth rate
  - Top 10 most-linked entities (wikilinks analysis)
  - Recently modified notes (7 days)
  - Stale notes (30+ days no modification)
  - Orphaned notes (no incoming wikilinks)
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

logger = logging.getLogger("acc-dashboard")


class VaultAnalytics:
    """Analyze vault entities with 5-min TTL cache."""

    def __init__(self, vault_path: str) -> None:
        self._root = Path(vault_path).resolve()
        self._cache: dict[str, Any] | None = None
        self._cache_ts: float = 0.0
        self._cache_ttl = 300  # 5 minutes

    def get_vitals(self, trend_data: list[dict[str, Any]] | None = None) -> dict[str, Any]:
        """Get vault vital signs with TTL cache.

        Args:
            trend_data: Optional 7-day vault_entities trend for growth rate calc.

        Returns:
            Dict with entity_count, growth_rate, top_linked, recently_modified,
            stale_notes, orphaned_notes.
        """
        import time
        now = time.time()
        if self._cache and (now - self._cache_ts) < self._cache_ttl:
            return self._cache

        vitals = self._compute_vitals(trend_data)
        self._cache = vitals
        self._cache_ts = now
        return vitals

    def _compute_vitals(self, trend_data: list[dict[str, Any]] | None) -> dict[str, Any]:
        """Compute vault vitals from filesystem scan."""
        if not self._root.is_dir():
            return {
                "entity_count": 0,
                "growth_rate": None,
                "top_linked": [],
                "recently_modified": [],
                "stale_notes": 0,
                "orphaned_notes": 0,
                "path": str(self._root),
            }

        # Collect all .md files (cap at 1000 for performance)
        md_files: list[Path] = []
        for p in sorted(self._root.rglob("*.md")):
            if p.is_file() and p.stat().st_size > 0:
                md_files.append(p)
                if len(md_files) >= 1000:
                    logger.warning("vault_vitals_capped", extra={"count": 1000})
                    break

        entity_count = len(md_files)

        # Growth rate from trend data
        growth_rate: float | None = None
        if trend_data and len(trend_data) >= 2:
            latest = trend_data[-1].get("value", 0)
            previous = trend_data[0].get("value", 0)
            if previous > 0:
                growth_rate = round((latest - previous) / previous, 4)

        # Wikilink analysis: count incoming [[...]] links
        wikilink_re = re.compile(r"\[\[([^\]|]+)(?:\|[^\]]+)?\]\]")
        incoming_links: dict[str, int] = {}  # link_name -> count
        file_content: dict[str, str] = {}  # relative_path -> content

        now_dt = datetime.now(timezone.utc)
        week_ago = now_dt - timedelta(days=7)
        month_ago = now_dt - timedelta(days=30)

        recently_modified: list[dict[str, Any]] = []
        stale_count = 0

        for f in md_files:
            try:
                stat = f.stat()
                mtime = datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc)
                rel_path = str(f.relative_to(self._root))

                # Read content for wikilink analysis
                try:
                    content = f.read_text(encoding="utf-8", errors="replace")
                except (OSError, UnicodeDecodeError):
                    content = ""

                # Skip frontmatter for link counting
                if content.startswith("---"):
                    fm_end = content.find("---", 3)
                    if fm_end > 0:
                        body = content[fm_end + 3:]
                    else:
                        body = content
                else:
                    body = content

                file_content[rel_path] = body

                # Extract wikilinks and count incoming
                for match in wikilink_re.finditer(body):
                    link_name = match.group(1).strip()
                    incoming_links[link_name] = incoming_links.get(link_name, 0) + 1

                # Recently modified
                if mtime >= week_ago:
                    recently_modified.append({
                        "path": rel_path,
                        "name": f.stem,
                        "modified": mtime.isoformat(),
                    })

                # Stale check
                if mtime < month_ago:
                    stale_count += 1

            except (OSError, ValueError):
                continue

        # Sort recently modified by mtime desc
        recently_modified.sort(key=lambda x: x["modified"], reverse=True)
        recently_modified = recently_modified[:20]

        # Top 10 most-linked entities
        top_linked = sorted(incoming_links.items(), key=lambda x: x[1], reverse=True)[:10]
        top_linked = [{"name": name, "incoming_links": count} for name, count in top_linked]

        # Orphaned: files with zero incoming wikilinks
        # Create a set of all file stems for matching
        file_stems = {f.stem.lower() for f in md_files}
        linked_names = {name.lower() for name in incoming_links}
        # Also include file names that are linked by their stem
        for name in list(incoming_links.keys()):
            linked_names.add(name.lower())

        orphan_count = sum(1 for stem in file_stems if stem not in linked_names)

        return {
            "entity_count": entity_count,
            "growth_rate": growth_rate,
            "top_linked": top_linked,
            "recently_modified": recently_modified,
            "stale_notes": stale_count,
            "orphaned_notes": orphan_count,
            "path": str(self._root),
        }