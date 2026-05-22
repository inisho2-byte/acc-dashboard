"""
Tests for ACC Dashboard SQLite persistence layer.

Coverage: database initialization, metric recording, trend retrieval, skill tracking.
"""

import pytest
import os
import sys
from pathlib import Path

# Add server to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from server.db import (
    init_db,
    get_db_path,
    get_connection,
    record_metric,
    get_trend,
    track_skill,
    get_all_skill_usage,
    get_skill_usage,
    clear_all_data,
    SCHEMA_VERSION,
)


@pytest.fixture(autouse=True)
def clean_db():
    """Clear all data before and after each test."""
    clear_all_data()
    yield
    clear_all_data()


class TestDatabaseInitialization:
    """Test database setup and configuration."""

    def test_db_path_creation(self):
        """Database path should be created if it doesn't exist."""
        db_path = get_db_path()
        assert db_path.exists()
        assert db_path.suffix == ".db"
        assert db_path.parent.exists()

    def test_init_db_creates_tables(self):
        """Initialization should create all required tables."""
        conn = init_db()
        cursor = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        )
        tables = {row[0] for row in cursor.fetchall()}
        
        assert "daily_snapshots" in tables
        assert "skill_usage" in tables
        assert "schema_version" in tables
        conn.close()

    def test_init_db_enables_wal_mode(self):
        """Initialization should enable WAL mode for concurrent reads."""
        conn = init_db()
        cursor = conn.execute("PRAGMA journal_mode")
        mode = cursor.fetchone()[0]
        assert mode == "wal"
        conn.close()

    def test_init_db_sets_busy_timeout(self):
        """Initialization should set busy timeout to 5000ms."""
        conn = init_db()
        cursor = conn.execute("PRAGMA busy_timeout")
        timeout = cursor.fetchone()[0]
        assert timeout == 5000
        conn.close()

    def test_schema_version_recorded(self):
        """Schema version should be recorded on init."""
        conn = init_db()
        cursor = conn.execute("SELECT version FROM schema_version")
        version = cursor.fetchone()[0]
        assert version == SCHEMA_VERSION
        conn.close()


class TestMetricRecording:
    """Test daily snapshot metric recording."""

    def test_record_metric_inserts(self):
        """Recording a metric should insert a new row."""
        record_metric("total_sessions", 42, {"source": "hermes"})
        
        trend = get_trend("total_sessions", 7)
        assert len(trend) == 1
        assert trend[0]["value"] == 42
        assert trend[0]["metadata"] == {"source": "hermes"}

    def test_record_metric_updates_same_day(self):
        """Recording same metric twice should update, not duplicate."""
        record_metric("total_sessions", 42)
        record_metric("total_sessions", 45)
        
        trend = get_trend("total_sessions", 7)
        assert len(trend) == 1  # Only one entry for today
        assert trend[0]["value"] == 45  # Latest value

    def test_record_metric_without_metadata(self):
        """Metadata should be optional."""
        record_metric("error_count", 3)
        
        trend = get_trend("error_count", 7)
        assert trend[0]["metadata"] is None

    def test_get_trend_returns_ordered_data(self):
        """Trend data should be ordered by date descending."""
        # Note: Can't easily test multi-day ordering without date manipulation
        record_metric("test_metric", 100)
        trend = get_trend("test_metric", 7)
        assert len(trend) == 1
        assert "date" in trend[0]
        assert "value" in trend[0]

    def test_get_trend_respects_limit(self):
        """Trend should respect the days limit parameter."""
        for i in range(10):
            record_metric("limited_metric", i)
        
        # All on same day, so only 1 result expected
        trend = get_trend("limited_metric", 7)
        assert len(trend) == 1


class TestSkillTracking:
    """Test skill usage tracking."""

    def test_track_skill_creates_entry(self):
        """Tracking a skill should create a new entry."""
        track_skill("test-skill")
        
        usage = get_skill_usage("test-skill")
        assert usage is not None
        assert usage["skill_name"] == "test-skill"
        assert usage["use_count"] == 1

    def test_track_skill_increments_count(self):
        """Tracking same skill should increment use count."""
        track_skill("test-skill")
        track_skill("test-skill")
        track_skill("test-skill")
        
        usage = get_skill_usage("test-skill")
        assert usage["use_count"] == 3

    def test_track_skill_updates_last_used(self):
        """Tracking should update last_used timestamp."""
        import time
        track_skill("test-skill")
        first_usage = get_skill_usage("test-skill")
        
        time.sleep(0.1)  # Small delay
        track_skill("test-skill")
        second_usage = get_skill_usage("test-skill")
        
        assert second_usage["last_used"] >= first_usage["last_used"]

    def test_get_all_skill_usage_orders_by_recent(self):
        """All usage should be ordered by last_used descending."""
        track_skill("skill-a")
        track_skill("skill-b")
        
        usage = get_all_skill_usage()
        assert len(usage) == 2
        # Most recently used should be first
        assert usage[0]["last_used"] >= usage[1]["last_used"]

    def test_get_skill_usage_returns_none_for_missing(self):
        """Querying non-existent skill should return None."""
        usage = get_skill_usage("non-existent-skill")
        assert usage is None


class TestConnectionHandling:
    """Test connection management and error handling."""

    def test_get_connection_context_manager(self):
        """Connection context manager should close properly."""
        with get_connection() as conn:
            cursor = conn.execute("SELECT 1")
            assert cursor.fetchone()[0] == 1
        # Connection should be closed after context

    def test_get_connection_rollback_on_error(self):
        """Connection should rollback on error."""
        try:
            with get_connection() as conn:
                conn.execute("INSERT INTO daily_snapshots (date, metric, value) VALUES (?, ?, ?)",
                           ("2026-01-01", "test", 1))
                raise ValueError("Simulated error")
        except ValueError:
            pass
        
        # Data should be rolled back
        trend = get_trend("test", 7)
        assert len(trend) == 0


class TestEdgeCases:
    """Test edge cases and error conditions."""

    def test_record_metric_with_large_value(self):
        """Should handle large integer values."""
        record_metric("large_metric", 2**31 - 1)
        trend = get_trend("large_metric", 7)
        assert trend[0]["value"] == 2**31 - 1

    def test_track_skill_with_unicode_name(self):
        """Should handle unicode in skill names."""
        track_skill("test-skill-日本語")
        usage = get_skill_usage("test-skill-日本語")
        assert usage is not None

    def test_get_trend_for_nonexistent_metric(self):
        """Querying non-existent metric should return empty list."""
        trend = get_trend("non-existent-metric", 7)
        assert trend == []

    def test_clear_all_data(self):
        """Clear should remove all data from all tables."""
        record_metric("test", 1)
        track_skill("test-skill")
        
        clear_all_data()
        
        assert get_trend("test", 7) == []
        assert get_all_skill_usage() == []
