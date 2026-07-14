"""ACC Dashboard — Agent Chat Engine Package.

Provides chat interfaces for three agent channels:
- ARETE (hermes chat subprocess via stdin pipe)
- Claude Code (claude.exe subprocess with stream-json parsing)
- Shu (HTTP POST to Tailscale peer + JSONL inbox polling)
"""
