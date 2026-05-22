"""Tailscale Mailbox Reader — reads inter-agent messages from JSONL mailbox files.

Replaces the old IBCBReader (which read from the IBCB SQLite bridge.db).
The Tailscale-based inter-agent link uses simple JSONL files:
  ~/from_shu.jsonl   — messages received from Shu
  arete_mailbox.log  — (optional) full mailbox server log

Each line is a JSON object: {"from": "shu"|"shu-trading"|"arete", "content": "...", "type": "...", "timestamp": "..."}

Sender types:
  "shu"          — normal chat messages from Shu
  "shu-trading"  — automated trading output (forex briefs, spike alerts)
  "arete"        — outbound messages from ARETE
"""

from __future__ import annotations

import json
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

logger = logging.getLogger(__name__)

MAILBOX_DIR = Path.home()
ARETE_INBOX = MAILBOX_DIR / "from_shu.jsonl"
ARETE_OUTBOX = MAILBOX_DIR / "send_to_shu.py"


class TailscaleMailboxReader:
    """Reads inter-agent messages from Tailscale mailbox JSONL files."""

    def __init__(self, inbox_path: str | Path = ARETE_INBOX) -> None:
        self._inbox_path = Path(inbox_path)

    def get_feed(self, limit: int = 30) -> list[dict]:
        """Return messages from the inbox sorted by time desc.

        Each message is enriched with:
          - direction: 'inbound' (from shu) or 'outbound' (from arete)
          - sender_label, recipient_label
          - message (the content field)
          - timestamp (file mtime fallback)
        """
        if not self._inbox_path.is_file():
            logger.debug(f"Mailbox not found: {self._inbox_path}")
            return []

        rows: list[dict] = []

        try:
            mtime = self._inbox_path.stat().st_mtime
        except OSError:
            mtime = None

        try:
            with open(self._inbox_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                    except json.JSONDecodeError:
                        logger.debug(f"Skipping malformed mailbox line: {line[:80]}")
                        continue

                    sender = data.get("from", "unknown")
                    content = data.get("content", "")
                    ts_iso = data.get("timestamp", "")

                    # Determine direction & label
                    if sender in ("shu", "shu-trading"):
                        direction = "inbound"
                        sender_label = "SHU-TRADING" if sender == "shu-trading" else "SHU"
                        recipient_label = "ARETE"
                    else:
                        direction = "outbound"
                        sender_label = "ARETE"
                        recipient_label = "SHU"

                    # Classify trading message type
                    msg_type = "chat"
                    if sender == "shu-trading":
                        raw_type = data.get("type", "")
                        # Explicit type field takes priority
                        if raw_type == "spike":
                            msg_type = "spike"
                        elif raw_type == "brief":
                            msg_type = "brief"
                        # Content-based classification for untyped messages
                        elif "scanner v2 tick" in content.lower() or "scanner tick" in content.lower():
                            msg_type = "spike"
                        elif "SPIKE" in content.upper() or "EXTREME" in content.upper() or "WARNING" in content.upper():
                            msg_type = "spike"
                        elif "FOREX RESEARCH" in content.upper() or "# FOREX RESEARCH" in content:
                            msg_type = "brief"
                        elif content.strip().startswith("#") or content.strip().startswith("**"):
                            msg_type = "brief"
                        else:
                            msg_type = "brief"

                    row = {
                        "sender": sender,
                        "recipient": "arete" if direction == "inbound" else "shu",
                        "direction": direction,
                        "sender_label": sender_label,
                        "recipient_label": recipient_label,
                        "message": content,
                        "msg_type": msg_type,
                        "action": data.get("action", ""),
                        "reference_id": data.get("reference_id", ""),
                        "latency_ms": data.get("latency_ms"),
                    }

                    # Timestamp: prefer explicit, fall back to file mtime
                    if ts_iso:
                        row["received_at"] = ts_iso
                    elif mtime:
                        row["received_at"] = datetime.fromtimestamp(
                            mtime, tz=timezone.utc
                        ).strftime("%Y-%m-%d %H:%M:%S")
                    else:
                        row["received_at"] = ""

                    rows.append(row)
        except OSError as exc:
            logger.error(f"Mailbox read failed: {exc}")
            return []

        # Sort by timestamp descending
        rows.sort(key=lambda r: r.get("received_at", "") or "", reverse=True)
        return rows[:limit]

    def get_stats(self) -> dict:
        """Return mailbox statistics."""
        if not self._inbox_path.is_file():
            logger.debug("Mailbox not found, returning empty stats")
            return {"inbound": 0, "outbound": 0, "peers": 1, "link": "tailscale"}

        inbound = 0
        outbound = 0

        try:
            with open(self._inbox_path, "r") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        data = json.loads(line)
                        sender = data.get("from", "unknown")
                        if sender in ("shu", "shu-trading"):
                            inbound += 1
                        else:
                            outbound += 1
                    except json.JSONDecodeError:
                        pass
        except OSError:
            pass

        return {
            "inbound": inbound,
            "outbound": outbound,
            "peers": 1,
            "link": "tailscale",
            "peer_details": [
                {"peer_name": "shu", "tailscale_ip": "100.85.6.14"},
            ],
        }


    def get_trading_feed(self, limit: int = 50) -> list[dict]:
        """Return only trading messages (from: shu-trading) sorted by time desc.

        Each message includes a msg_type field: 'brief' or 'spike'.
        """
        all_msgs = self.get_feed(limit=500)
        trading = [m for m in all_msgs if m.get("sender") == "shu-trading"]
        return trading[:limit]


# Backward-compatible alias so import paths still work
IBCBReader = TailscaleMailboxReader