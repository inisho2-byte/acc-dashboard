"""Pipeline Engine — derives multi-agent pipeline state from Tailscale mailbox messages + sessions.

Models the ARETE ↔ Shu conversation flow as a pipeline:
  Stage 1: ARETE initiates task (session created)
  Stage 2: ARETE dispatches to Shu (outbound mailbox message)
  Stage 3: Shu processes (inbound mailbox message latency)
  Stage 4: Shu responds (inbound message with content)
  Stage 5: ARETE reviews (new session referencing Shu's response)
"""
from __future__ import annotations

import logging
from typing import Any

from server.aggregators.ibcb_reader import IBCBReader

logger = logging.getLogger(__name__)


class PipelineStage:
    """A single stage in the agent pipeline."""
    def __init__(self, stage_id: str, agent: str, status: str,
                 timestamp: str | None = None, summary: str = "") -> None:
        self.stage_id = stage_id
        self.agent = agent
        self.status = status  # "active", "completed", "waiting", "idle"
        self.timestamp = timestamp
        self.summary = summary

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.stage_id,
            "agent": self.agent,
            "status": self.status,
            "timestamp": self.timestamp,
            "summary": self.summary,
        }


class PipelineEngine:
    """Derives pipeline state from Tailscale mailbox messages and session data."""

    def __init__(self, mailbox: IBCBReader | None = None) -> None:
        self._mailbox = mailbox or IBCBReader()

    def get_pipeline(self, limit: int = 10) -> dict[str, Any]:
        """Build the current pipeline state from mailbox messages.

        Returns:
            Dict with "stages" list and "active" boolean.
        """
        stages: list[PipelineStage] = []

        try:
            feed = self._mailbox.get_feed(limit=min(limit * 2, 50))
        except Exception:
            feed = []

        if not feed:
            return {"stages": [], "active": False, "message": "No inter-agent messages found"}

        # Classify messages by direction and derive pipeline stages
        outbound_msgs = [m for m in feed if m.get("direction") == "outbound" or m.get("from") == "arete"]
        inbound_msgs = [m for m in feed if m.get("direction") == "inbound" or m.get("from") == "shu"]

        # Stage 1: ARETE initiates
        if outbound_msgs:
            first_out = outbound_msgs[-1]  # most recent
            stages.append(PipelineStage(
                stage_id="arete_initiate",
                agent="arete",
                status="completed" if inbound_msgs else "active",
                timestamp=first_out.get("received_at"),
                summary=first_out.get("message", "")[:120] if first_out.get("message") else "Task dispatched",
            ))

        # Stage 2: Shu receives
        if inbound_msgs:
            first_in = inbound_msgs[-1]
            stages.append(PipelineStage(
                stage_id="shu_receive",
                agent="shu",
                status="completed",
                timestamp=first_in.get("received_at"),
                summary=first_in.get("message", "")[:120] if first_in.get("message") else "Shu received task",
            ))

        # Stage 3: Shu responds
        if len(inbound_msgs) > 1:
            latest_in = inbound_msgs[0]  # most recent inbound
            stages.append(PipelineStage(
                stage_id="shu_respond",
                agent="shu",
                status="completed",
                timestamp=latest_in.get("received_at"),
                summary=latest_in.get("message", "")[:120] if latest_in.get("message") else "Shu responded",
            ))

        # Stage 4: ARETE reviews (if there's outbound after inbound response)
        if outbound_msgs and inbound_msgs:
            stages.append(PipelineStage(
                stage_id="arete_review",
                agent="arete",
                status="waiting",
                summary="Awaiting ARETE review",
            ))

        active = any(s.status == "active" or s.status == "waiting" for s in stages)

        return {
            "stages": [s.to_dict() for s in stages],
            "active": active,
            "message": None if stages else "No pipeline activity",
        }