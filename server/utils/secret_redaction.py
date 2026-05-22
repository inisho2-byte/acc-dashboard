"""Regex-based secret pattern redaction for Claude Code data.

All content served from ~/.claude/ passes through redact_secrets()
to prevent accidental exposure of API keys, tokens, and credentials.
"""

from __future__ import annotations

import re

# Compiled patterns for common secret formats.
# Each pattern captures the secret portion and replaces it with a redacted marker.
SECRET_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # OpenAI-style API keys (sk-...)
    ("api_key", re.compile(r"(sk-[a-zA-Z0-9]{20,})")),
    # GitHub Personal Access Tokens (ghp_...)
    ("github_pat", re.compile(r"(ghp_[a-zA-Z0-9]{36,})")),
    # GitLab Personal Access Tokens (glpat-...)
    ("gitlab_pat", re.compile(r"(glpat-[a-zA-Z0-9\-]{20,})")),
    # Generic api_key = "..." patterns
    (
        "api_key_assignment",
        re.compile(
            r'(api[_-]?key\s*[:=]\s*["\']?[a-zA-Z0-9]{16,})',
            re.IGNORECASE,
        ),
    ),
    # Generic token = "..." patterns
    (
        "token_assignment",
        re.compile(
            r'(token\s*[:=]\s*["\']?[a-zA-Z0-9\-_.]{20,})',
            re.IGNORECASE,
        ),
    ),
    # Generic password = "..." patterns
    (
        "password_assignment",
        re.compile(
            r'(password\s*[:=]\s*["\']?[^\s"\']{8,})',
            re.IGNORECASE,
        ),
    ),
    # Bearer tokens in Authorization headers
    ("bearer_token", re.compile(r"(Bearer\s+[a-zA-Z0-9\-_.]+)")),
    # URLs with embedded secrets (key=, token=, secret=, auth=)
    (
        "url_secret",
        re.compile(
            r'(https?://[^\s"\']*?(?:key|token|secret|auth)[^\s"\']*?=)[^\s"\']+'
        ),
    ),
]


def redact_secrets(text: str) -> str:
    """Redact known secret patterns from text.

    Replaces matched secret values with [REDACTED_<type>] markers
    while preserving surrounding context for readability.
    """
    if not text:
        return text

    for label, pattern in SECRET_PATTERNS:
        text = pattern.sub(f"[REDACTED_{label}]", text)

    return text