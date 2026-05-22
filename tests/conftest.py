"""Shared test fixtures for ACC Dashboard tests."""

import asyncio
import os
import tempfile
from pathlib import Path
from typing import AsyncGenerator

import httpx
import pytest
import pytest_asyncio


# ── Async event loop fixture ──

@pytest.fixture(scope="session")
def event_loop():
    """Create a single event loop for the entire session."""
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ── Temp Vault Fixture ──

@pytest.fixture
def temp_vault():
    """Create a temporary vault directory with an empty 04-projects dir."""
    with tempfile.TemporaryDirectory() as tmpdir:
        vault_root = Path(tmpdir)
        projects_dir = vault_root / "04-projects"
        projects_dir.mkdir(parents=True)
        yield vault_root


@pytest.fixture
def project_dir(temp_vault: Path) -> Path:
    """Create a single project directory inside temp_vault."""
    proj_dir = temp_vault / "04-projects" / "test-project"
    proj_dir.mkdir(parents=True, exist_ok=True)
    return proj_dir
