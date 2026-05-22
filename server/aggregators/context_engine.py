from __future__ import annotations

import logging
import re
from collections import Counter
from pathlib import Path

from server.agents.hermes_adapter import HermesAdapter
from server.agents.shu_adapter import ShuDiscordAdapter

logger = logging.getLogger(__name__)

_STOP_WORDS = {
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "by", "from", "up", "about", "into", "over", "after",
    "is", "are", "was", "were", "be", "been", "being", "have", "has",
    "had", "do", "does", "did", "will", "would", "can", "could", "shall",
    "should", "may", "might", "must", "i", "you", "he", "she", "it",
    "we", "they", "this", "that", "these", "those", "my", "your", "his",
    "her", "its", "our", "their", "no", "not", "none", "nor", "neither",
    "so", "as", "if", "then", "else", "when", "where", "why", "how",
    "all", "each", "every", "both", "few", "more", "most", "other",
    "some", "such", "only", "own", "same", "here", "there", "just",
    "also", "very", "too", "really", "get", "got", "use", "used",
    "using", "make", "made", "making", "like", "well", "even", "back",
    "still", "already", "yet", "much", "while", "during",
}

_MIN_KEYWORD_LENGTH = 3


class ContextEngine:
    """Compares agent contexts to surface knowledge gaps."""

    def __init__(
        self,
        hermes: HermesAdapter,
        shu: ShuDiscordAdapter,
    ) -> None:
        self._hermes = hermes
        self._shu = shu

    @staticmethod
    def _extract_keywords(text: str) -> list[str]:
        """Tokenize and extract meaningful keywords from text."""
        tokens = re.findall(r"[a-zA-Z][a-zA-Z0-9]{2,}", text.lower())
        return [
            t for t in tokens
            if len(t) >= _MIN_KEYWORD_LENGTH and t not in _STOP_WORDS
        ]

    @staticmethod
    def _stem(word: str) -> str:
        """Simple suffix-based stemming (English)."""
        w = word.lower()
        if w.endswith("ing") and len(w) > 5:
            w = w[:-3]
        elif w.endswith("ied") and len(w) > 4:
            w = w[:-3] + "y"
        elif w.endswith("ed") and len(w) > 4 and w[-3] not in ("a", "e", "i", "o", "u"):
            w = w[:-2]
        elif w.endswith("es") and len(w) > 4:
            w = w[:-2]
        elif w.endswith("s") and not w.endswith("ss") and len(w) > 3:
            w = w[:-1]
        return w

    async def get_gaps(self, limit: int = 50) -> dict:
        """Compare recent ARETE sessions vs Shu messages to find knowledge gaps.

        Returns:
            arete_topics: Keywords from ARETE sessions with counts
            shu_topics: Keywords from Shu messages with counts
            gaps: {
                arete_only: keywords ARETE knows that Shu doesn't,
                shu_only: keywords Shu knows that ARETE doesn't,
                shared: keywords both agents use
            }
        """
        # Fetch recent data
        arete_sessions = await self._hermes.recent_sessions(limit)
        shu_messages = await self._shu.recent_sessions(limit)

        # Extract and count keywords
        arete_text = " ".join(
            f"{s.title or ''} {s.preview or ''}" for s in arete_sessions
        )
        shu_text = " ".join(
            f"{m.title or ''} {m.preview or ''}" for m in shu_messages
        )

        arete_keywords_raw = self._extract_keywords(arete_text)
        shu_keywords_raw = self._extract_keywords(shu_text)

        # Count with stemming
        arete_counts: dict[str, int] = Counter()
        for kw in arete_keywords_raw:
            stemmed = self._stem(kw)
            if stemmed:
                arete_counts[stemmed] += 1

        shu_counts: dict[str, int] = Counter()
        for kw in shu_keywords_raw:
            stemmed = self._stem(kw)
            if stemmed:
                shu_counts[stemmed] += 1

        # Compute gap analysis
        arete_set = set(arete_counts.keys())
        shu_set = set(shu_counts.keys())

        arete_only = {
            kw: arete_counts[kw]
            for kw in sorted(arete_set - shu_set, key=lambda k: -arete_counts[k])
        }
        shu_only = {
            kw: shu_counts[kw]
            for kw in sorted(shu_set - arete_set, key=lambda k: -shu_counts[k])
        }
        shared = {
            kw: {"arete": arete_counts[kw], "shu": shu_counts[kw]}
            for kw in sorted(arete_set & shu_set, key=lambda k: -(arete_counts[kw] + shu_counts[kw]))
        }

        return {
            "arete_topics": dict(arete_counts.most_common(50)),
            "shu_topics": dict(shu_counts.most_common(50)),
            "gaps": {
                "arete_only": dict(list(arete_only.items())[:20]),
                "shu_only": dict(list(shu_only.items())[:20]),
                "shared": dict(list(shared.items())[:20]),
            },
            "session_counts": {
                "arete": len(arete_sessions),
                "shu": len(shu_messages),
            },
        }
