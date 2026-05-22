from __future__ import annotations

import asyncio
import logging
import math
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from server.agents.hermes_adapter import HermesAdapter
from server.agents.shu_adapter import ShuDiscordAdapter

logger = logging.getLogger(__name__)

# Minimum word length for index
_MIN_WORD = 3
_MAX_RESULTS = 50
_VAULT_SCAN_LIMIT = 500  # Max files to index
_INDEX_CONCURRENCY = 10  # Max parallel file reads


class SearchEngine:
    """Lightweight in-memory TF-IDF search across agent sessions, Discord msgs, and vault files."""

    def __init__(
        self,
        hermes: HermesAdapter,
        shu: ShuDiscordAdapter,
        vault_path: str = "",
        discord_cfg: dict | None = None,
    ) -> None:
        self._hermes = hermes
        self._shu = shu
        self._vault_path = vault_path
        self._discord_cfg = discord_cfg or {}
        self._docs: dict[str, dict[str, Any]] = {}  # doc_id → metadata
        self._index: dict[str, list[tuple[str, int]]] = {}  # term → [(doc_id, count)]
        self._initialized = False

    # ── Tokenizer ─────────────────────────────────────────────

    @staticmethod
    def _tokenize(text: str) -> list[str]:
        """Split text into lowercase word tokens."""
        tokens = re.findall(r"[a-zA-Z0-9]+(?:[-_][a-zA-Z0-9]+)*", text.lower())
        return [t for t in tokens if len(t) >= _MIN_WORD]

    # ── Indexing ──────────────────────────────────────────────

    async def rebuild(self) -> dict[str, int]:
        """Full rebuild of the search index from all sources. Returns doc count per source."""
        self._docs.clear()
        self._index.clear()
        self._initialized = False

        counts: dict[str, int] = {}

        # 1. Index Hermes sessions
        try:
            sessions = await self._hermes.recent_sessions(200)
            for s in sessions:
                text = f"{s.title} {s.preview} {s.id}"
                if text.strip():
                    self._add_doc(
                        doc_id=f"sess-{s.id}",
                        source="session",
                        title=s.title or "(session)",
                        content=text,
                        agent_id="arete",
                        timestamp=s.last_active.isoformat() if s.last_active else None,
                    )
            counts["sessions"] = len(sessions)
        except Exception:
            counts["sessions"] = 0

        # 2. Index Discord messages
        try:
            messages = await self._shu.recent_sessions(100)
            for m in messages:
                text = f"{m.title} {m.preview}"
                if text.strip():
                    self._add_doc(
                        doc_id=f"discord-{m.id}",
                        source="discord",
                        title=m.title or "(message)",
                        content=text,
                        agent_id="shu",
                        timestamp=m.last_active.isoformat() if m.last_active else None,
                    )
            counts["discord"] = len(messages)
        except Exception:
            counts["discord"] = 0

        # 3. Index vault markdown files (parallel with semaphore)
        vault_count = 0
        vault_skipped = 0
        if self._vault_path and Path(self._vault_path).is_dir():
            vault_root = Path(self._vault_path)
            md_files = list(vault_root.rglob("*.md"))
            
            # Warn if exceeding limit
            if len(md_files) > _VAULT_SCAN_LIMIT:
                vault_skipped = len(md_files) - _VAULT_SCAN_LIMIT
                logger.warning(
                    f"Vault has {len(md_files)} files, indexing first {_VAULT_SCAN_LIMIT} only "
                    f"({vault_skipped} files skipped)"
                )
            
            # Filter out system/archive directories
            filtered_files = []
            for fpath in md_files[:_VAULT_SCAN_LIMIT]:
                rel = fpath.relative_to(vault_root)
                parts = rel.parts
                if any(p.startswith(".") or p in ("07-archive", "node_modules", ".git") for p in parts):
                    continue
                filtered_files.append(fpath)
            
            # Parallel indexing with semaphore to limit concurrency
            semaphore = asyncio.Semaphore(_INDEX_CONCURRENCY)
            
            async def index_file(fpath: Path) -> dict | None:
                """Index a single file with semaphore-controlled concurrency."""
                async with semaphore:
                    rel = fpath.relative_to(vault_root)
                    try:
                        text = await asyncio.to_thread(fpath.read_text, encoding="utf-8", errors="replace")
                        if len(text) > 10000:
                            text = text[:10000]  # cap file size
                            logger.debug(f"Truncated {rel} to 10KB")
                        title = fpath.stem.replace("-", " ").replace("_", " ").title()
                        # Try to extract H1
                        for line in text.splitlines():
                            line = line.strip()
                            if line.startswith("# ") and not line.startswith("##"):
                                title = line[2:].strip()
                                break
                        self._add_doc(
                            doc_id=f"vault-{rel}",
                            source="vault",
                            title=title,
                            content=text,
                            agent_id="vault",
                            timestamp=str(datetime.fromtimestamp(fpath.stat().st_mtime, tz=timezone.utc)),
                        )
                        return {"doc_id": f"vault-{rel}", "success": True}
                    except (OSError, UnicodeDecodeError) as exc:
                        logger.debug(f"Failed to index {rel}: {exc}")
                        return {"doc_id": f"vault-{rel}", "success": False, "error": str(exc)}
            
            # Run all indexing tasks concurrently (bounded by semaphore)
            tasks = [index_file(fpath) for fpath in filtered_files]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            # Count successes
            vault_count = sum(1 for r in results if isinstance(r, dict) and r.get("success"))
            failures = sum(1 for r in results if isinstance(r, dict) and not r.get("success"))
            if failures > 0:
                logger.debug(f"Vault indexing: {failures} files failed")
            
            # Check for exceptions
            exceptions = [r for r in results if isinstance(r, Exception)]
            if exceptions:
                logger.error(f"Vault indexing had {len(exceptions)} unexpected errors")
        
        counts["vault"] = vault_count
        if vault_skipped > 0:
            counts["vault_skipped"] = vault_skipped

        # 4. Index errors (A7)
        try:
            arete_errs = await self._hermes.recent_errors(50)
            for e in arete_errs:
                self._add_error_doc(e)
            counts["errors"] = len(arete_errs)
        except Exception:
            counts["errors"] = 0

        # 5. Index cron jobs (A7)
        try:
            cron_jobs = await self._hermes.list_cron_jobs()
            for j in cron_jobs:
                self._add_cron_doc(j)
            counts["cron"] = len(cron_jobs)
        except Exception:
            counts["cron"] = 0

        self._initialized = True
        return counts

    def _add_error_doc(self, err) -> None:
        """Index a single error record."""
        self._add_doc(
            doc_id=f"err-{err.id}",
            source="error",
            title=err.message[:80] if err.message else "(error)",
            content=f"{err.message} {err.agent_id} {err.severity}",
            agent_id=err.agent_id,
            timestamp=err.timestamp.isoformat() if err.timestamp else None,
        )

    def _add_cron_doc(self, cron_job: dict) -> None:
        """Index a single cron job."""
        name = cron_job.get("name", cron_job.get("id", "unknown"))
        schedule = cron_job.get("schedule", "")
        last_status = cron_job.get("last_status", "")
        self._add_doc(
            doc_id=f"cron-{cron_job.get('id', name)}",
            source="cron",
            title=f"Cron: {name}",
            content=f"{name} {schedule} {last_status}",
            agent_id="arete",
            timestamp=cron_job.get("last_run", ""),
        )

    def _add_doc(
        self,
        doc_id: str,
        source: str,
        title: str,
        content: str,
        agent_id: str,
        timestamp: str | None = None,
    ) -> None:
        """Add a document to the index."""
        content_preview = content[:500] if content else ""

        # Derive action_url and action_label from source (A8)
        action_url = ""
        action_label = ""
        if source == "session":
            sess_id = doc_id.replace("sess-", "", 1)
            action_label = f"Resume session {sess_id}"
        elif source == "discord":
            msg_id = doc_id.replace("discord-", "", 1)
            guild_id = self._discord_cfg.get("guild_id", "@me")
            channel_id = self._discord_cfg.get("shu_channel_id", "")
            action_url = f"https://discord.com/channels/{guild_id}/{channel_id}/{msg_id}"
            action_label = "Open in Discord"
        elif source == "vault":
            vault_path = doc_id.replace("vault-", "", 1)
            encoded = vault_path.replace(" ", "%20").replace("/", "/")
            action_url = f"obsidian://open?vault=Second%20brain&file={encoded}"
            action_label = "Open in Obsidian"
        elif source == "error":
            action_label = "View error details"
        elif source == "cron":
            action_label = "View cron job"

        self._docs[doc_id] = {
            "id": doc_id,
            "source": source,
            "title": title,
            "agent_id": agent_id,
            "timestamp": timestamp or "",
            "content_preview": content_preview,
            "action_url": action_url,
            "action_label": action_label,
        }

        tokens = self._tokenize(content)
        term_counts = Counter(tokens)

        for term, count in term_counts.items():
            if term not in self._index:
                self._index[term] = []
            self._index[term].append((doc_id, count))

    # ── Searching ─────────────────────────────────────────────

    async def search(
        self,
        query: str,
        limit: int = 20,
        source: str | None = None,
    ) -> dict[str, Any]:
        """Search the index and return ranked results grouped by source."""
        if not self._initialized:
            await self.rebuild()

        query_tokens = self._tokenize(query)
        if not query_tokens:
            return {"query": query, "results": [], "total": 0, "sources": {}}

        # Calculate IDF for each query term
        total_docs = len(self._docs)
        scores: dict[str, float] = defaultdict(float)

        for term in query_tokens:
            if term not in self._index:
                continue
            postings = self._index[term]
            df = len(postings)
            idf = math.log((total_docs + 1) / (df + 1)) + 1  # smooth IDF

            for doc_id, tf in postings:
                # Simple TF: log-scaled
                tf_weight = 1 + math.log(tf) if tf > 0 else 0
                scores[doc_id] += tf_weight * idf

        # Sort by score descending
        ranked = sorted(scores.items(), key=lambda x: (-x[1], x[0]))

        # Build results grouped by source
        results: list[dict] = []
        sources: dict[str, int] = {}

        for doc_id, score in ranked[:limit]:
            doc = self._docs.get(doc_id)
            if not doc:
                continue
            if source and doc["source"] != source:
                continue

            snippet = self._generate_snippet(doc, query_tokens)
            results.append({
                "id": doc_id,
                "source": doc["source"],
                "title": doc["title"],
                "agent_id": doc["agent_id"],
                "timestamp": doc["timestamp"],
                "snippet": snippet,
                "score": round(score, 2),
                "action_url": doc.get("action_url", ""),
                "action_label": doc.get("action_label", ""),
            })
            sources[doc["source"]] = sources.get(doc["source"], 0) + 1

        return {
            "query": query,
            "total": len(ranked),
            "results": results,
            "sources": sources,
        }

    @staticmethod
    def _generate_snippet(doc: dict, query_tokens: list[str], context: int = 40) -> str:
        """Extract a snippet around the first query term match in stored content preview."""
        content = doc.get("content_preview", doc.get("title", ""))
        title = doc.get("title", "")
        if not content and not title:
            return "(no preview)"

        # Search for first query term occurrence in content preview (case-insensitive)
        content_lower = content.lower()
        best_pos = -1
        best_term = ""
        for term in query_tokens:
            pos = content_lower.find(term)
            if pos != -1 and (best_pos == -1 or pos < best_pos):
                best_pos = pos
                best_term = term

        if best_pos == -1:
            # Fallback: use title
            return title[:120] if title else content[:120]

        # Extract context window around match
        start = max(0, best_pos - context)
        end = min(len(content), best_pos + len(best_term) + context)

        snippet = content[start:end]
        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet = snippet + "..."

        return snippet
