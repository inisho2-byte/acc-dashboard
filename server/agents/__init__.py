from __future__ import annotations

from abc import ABC, abstractmethod
from datetime import datetime

from server.models import AgentError, AgentSession, AgentStatus


class AgentAdapter(ABC):
    """Abstract base for all agent adapters."""

    @property
    @abstractmethod
    def agent_id(self) -> str: ...

    @property
    @abstractmethod
    def agent_type(self) -> str: ...

    @property
    @abstractmethod
    def display_name(self) -> str: ...

    @abstractmethod
    async def health(self) -> AgentStatus: ...

    @abstractmethod
    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]: ...

    @abstractmethod
    async def recent_errors(self, limit: int = 10) -> list[AgentError]: ...

    def status_from_online(self, online: bool) -> str:
        if online:
            return "online"
        return "offline"
