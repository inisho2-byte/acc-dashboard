"""Unit tests for Group 2 aggregators."""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch
from pathlib import Path

from server.aggregators.activity_engine import ActivityEngine
from server.aggregators.briefing import BriefingGenerator
from server.aggregators.context_engine import ContextEngine
from server.aggregators.ibcb_reader import IBCBReader
from server.aggregators.memory_reader import MemoryReader
from server.aggregators.search_engine import SearchEngine
from server.models import ActivityEvent, AgentSession, AgentError


# ── ActivityEngine Tests ──────────────────────────────────────────────

@pytest.fixture
def mock_hermes():
    h = MagicMock()
    h.recent_sessions = AsyncMock(return_value=[
        AgentSession(id="s1", agent_id="arete", title="Test session", preview="Testing...",
                     last_active=datetime.now(timezone.utc)),
        AgentSession(id="s1", agent_id="arete", title="Test session", preview="Testing...",
                     last_active=datetime.now(timezone.utc)),  # Duplicate
    ])
    h.recent_errors = AsyncMock(return_value=[])
    h.list_cron_jobs = AsyncMock(return_value=[])
    return h


@pytest.fixture
def mock_shu():
    s = MagicMock()
    s.recent_sessions = AsyncMock(return_value=[])
    s.recent_errors = AsyncMock(return_value=[])
    return s


@pytest.fixture
def mock_vault():
    v = MagicMock()
    v.get_recent_changes = MagicMock(return_value=[])
    return v


@pytest.mark.asyncio
async def test_activity_engine_dedup(mock_hermes, mock_shu, mock_vault):
    """Test that duplicate events by ID are removed."""
    engine = ActivityEngine(mock_hermes, mock_shu, vault=mock_vault)
    events = await engine.get_timeline(limit=50)
    ids = [e.id for e in events]
    assert len(ids) == len(set(ids)), "Duplicate event IDs found"
    assert len(events) >= 1


@pytest.mark.asyncio
async def test_activity_engine_agent_filter(mock_hermes, mock_shu, mock_vault):
    """Test per-agent filtering."""
    engine = ActivityEngine(mock_hermes, mock_shu, vault=mock_vault)
    arete_events = await engine.get_timeline(limit=50, agent_id="arete")
    for e in arete_events:
        assert e.agent_id == "arete"


@pytest.mark.asyncio
async def test_activity_engine_vault_changes(mock_hermes, mock_shu):
    """Test vault change events are included."""
    vault = MagicMock()
    vault.get_recent_changes = MagicMock(return_value=[
        {"id": "vault-test", "path": "04-projects/test/index.md",
         "event_type": "vault_change", "timestamp": datetime.now(timezone.utc),
         "summary": "Vault: Test Project", "details": {"project": "test", "file": "index.md"}}
    ])
    engine = ActivityEngine(mock_hermes, mock_shu, vault=vault)
    events = await engine.get_timeline(limit=50)
    vault_events = [e for e in events if e.event_type == "vault_change"]
    assert len(vault_events) > 0
    assert vault_events[0].summary == "Vault: Test Project"


# ── BriefingGenerator Tests ───────────────────────────────────────────

@pytest.mark.asyncio
async def test_briefing_narrative(mock_hermes, mock_shu, mock_vault):
    """Test narrative summary generation."""
    engine = ActivityEngine(mock_hermes, mock_shu, vault=mock_vault)
    briefing = BriefingGenerator(engine, mock_vault)
    result = await briefing.generate(hours=24)
    assert "narrative" in result
    assert isinstance(result["narrative"], str)
    assert len(result["narrative"]) > 0


@pytest.mark.asyncio
async def test_briefing_since_timestamp(mock_hermes, mock_shu, mock_vault):
    """Test that since parameter is respected."""
    engine = ActivityEngine(mock_hermes, mock_shu, vault=mock_vault)
    briefing = BriefingGenerator(engine, mock_vault)
    since = datetime.now(timezone.utc) - timedelta(hours=48)
    result = await briefing.generate(since=since)
    assert "since_timestamp" in result
    assert result["since_timestamp"] is not None


@pytest.mark.asyncio
async def test_briefing_empty():
    """Test briefing with no data (empty engine)."""
    from server.models import ActivityEvent
    activity = MagicMock()
    activity.get_timeline = AsyncMock(return_value=[])
    vault = MagicMock()
    vault.get_all_projects = MagicMock(return_value=[])
    briefing = BriefingGenerator(activity, vault)
    result = await briefing.generate(hours=1)
    assert result["summary"]["total_events"] == 0
    assert "narrative" in result


# ── SearchEngine Tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_search_snippet_generation():
    """Test that snippets extract context around query terms."""
    engine = SearchEngine(MagicMock(), MagicMock())
    # Manually add a doc with content
    engine._docs["sess-test1"] = {
        "id": "sess-test1",
        "source": "session",
        "title": "My Session",
        "agent_id": "arete",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "content_preview": "This is a test document about debugging and tracing for the application.",
        "action_url": "",
        "action_label": "Resume session test1",
    }
    snippet = engine._generate_snippet(
        engine._docs["sess-test1"],
        ["debugging"]
    )
    assert "debugging" in snippet.lower()
    assert len(snippet) > 20


@pytest.mark.asyncio
async def test_search_action_urls():
    """Test that action URLs are generated per source type."""
    # Session doc
    engine = SearchEngine(MagicMock(), MagicMock())
    engine._add_doc("sess-abc", "session", "Test", "test content", "arete")
    assert "action_label" in engine._docs["sess-abc"]
    assert "Resume session abc" in engine._docs["sess-abc"]["action_label"]

    # Discord doc with guild/channel config
    engine2 = SearchEngine(MagicMock(), MagicMock(), discord_cfg={
        "guild_id": "123", "shu_channel_id": "456"
    })
    engine2._add_doc("discord-msg789", "discord", "Msg", "hello", "shu")
    doc = engine2._docs["discord-msg789"]
    assert "action_url" in doc
    assert "discord.com/channels" in doc["action_url"]

    # Vault doc
    engine3 = SearchEngine(MagicMock(), MagicMock())
    engine3._add_doc("vault-04-projects/test/index.md", "vault", "Test", "content", "vault")
    doc3 = engine3._docs["vault-04-projects/test/index.md"]
    assert "obsidian://" in doc3["action_url"]


@pytest.mark.asyncio
async def test_search_tokenize():
    """Test tokenization."""
    tokens = SearchEngine._tokenize("Hello World Test")
    assert len(tokens) >= 3
    assert "hello" in tokens


# ── TailscaleMailboxReader Tests ──────────────────────────────────────

def test_mailbox_no_file(tmp_path):
    """Test graceful handling of missing mailbox file."""
    reader = IBCBReader(inbox_path=tmp_path / "nonexistent.jsonl")
    feed = reader.get_feed()
    assert feed == []
    stats = reader.get_stats()
    assert stats == {"inbound": 0, "outbound": 0, "peers": 1, "link": "tailscale"}


def test_mailbox_read(tmp_path):
    """Test reading messages from a mailbox JSONL file."""
    mailbox = tmp_path / "from_shu.jsonl"
    mailbox.write_text(
        '{"from": "shu", "content": "hello from shu"}\n'
        '{"from": "arete", "content": "task result X"}\n'
    )
    reader = IBCBReader(inbox_path=mailbox)
    feed = reader.get_feed()
    assert len(feed) == 2
    # Inbound (shu) should be first after desc sort by default (same mtime)
    directions = [m["direction"] for m in feed]
    assert "inbound" in directions
    assert "outbound" in directions


def test_mailbox_stats(tmp_path):
    """Test stats counting from mailbox JSONL."""
    mailbox = tmp_path / "from_shu.jsonl"
    mailbox.write_text(
        '{"from": "shu", "content": "msg1"}\n'
        '{"from": "shu", "content": "msg2"}\n'
        '{"from": "arete", "content": "out1"}\n'
    )
    reader = IBCBReader(inbox_path=mailbox)
    stats = reader.get_stats()
    assert stats["inbound"] == 2
    assert stats["outbound"] == 1
    assert stats["link"] == "tailscale"


def test_mailbox_malformed_line(tmp_path):
    """Test graceful handling of malformed JSONL lines."""
    mailbox = tmp_path / "from_shu.jsonl"
    mailbox.write_text(
        '{"from": "shu", "content": "good"}\n'
        'BADLINE\n'
        '{"from": "shu", "content": "also good"}\n'
    )
    reader = IBCBReader(inbox_path=mailbox)
    feed = reader.get_feed()
    assert len(feed) == 2


# ── ContextEngine Tests ───────────────────────────────────────────────

@pytest.mark.asyncio
async def test_context_engine_keywords():
    """Test keyword extraction and gap detection."""
    hermes = MagicMock()
    hermes.recent_sessions = AsyncMock(return_value=[
        AgentSession(id="s1", agent_id="arete", title="Debugging API endpoints",
                     preview="Tracing errors in API...",
                     last_active=datetime.now(timezone.utc)),
    ])
    shu = MagicMock()
    shu.recent_sessions = AsyncMock(return_value=[
        AgentSession(id="m1", agent_id="shu", title="Discord setup",
                     preview="Configuring bot...",
                     last_active=datetime.now(timezone.utc)),
    ])
    ctx = ContextEngine(hermes, shu)
    result = await ctx.get_gaps(limit=50)
    assert "arete_topics" in result
    assert "shu_topics" in result
    assert "gaps" in result
    assert "arete_only" in result["gaps"] or "shu_only" in result["gaps"]


def test_context_engine_stem():
    """Test stemming."""
    assert ContextEngine._stem("debugging") == "debugg"
    assert ContextEngine._stem("running") == "runn"
    assert ContextEngine._stem("test") == "test"


def test_context_engine_stop_words():
    """Test stop word filtering."""
    keywords = ContextEngine._extract_keywords("the and for debugging")
    assert "debugging" in keywords
    assert "the" not in keywords
    assert "and" not in keywords


# ── MemoryReader Tests ────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_memory_reader_arete():
    """Test ARETE memory reading with real files."""
    hermes = MagicMock()
    shu = MagicMock()
    reader = MemoryReader(hermes, shu)
    result = await reader.get_arete_memory()
    assert result["agent_id"] == "arete"
    assert "sources" in result
    # MEMORY.md may or may not exist depending on environment
    assert isinstance(result["sources"], dict)
    assert "available" in result


@pytest.mark.asyncio
async def test_memory_reader_shu():
    """Test Shu memory reading."""
    hermes = MagicMock()
    shu = MagicMock()
    shu.recent_sessions = AsyncMock(return_value=[])
    reader = MemoryReader(hermes, shu)
    result = await reader.get_shu_memory()
    assert result["agent_id"] == "shu"
    assert "sources" in result
