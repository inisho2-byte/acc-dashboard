"""
Unit tests for VaultReader — file-based project reader with delta detection.

Coverage: valid project, missing frontmatter, malformed YAML,
path traversal attempt, cache TTL, file signatures.
"""

from __future__ import annotations

import sys
import time
from pathlib import Path
from datetime import datetime
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, str(Path(__file__).parent.parent))

from server.vault import VaultReader
from server.models import ProjectStatus


# ── Helpers ────────────────────────────────────────────────────────────────


def _write_md(path: Path, content: str) -> Path:
    """Write content to a markdown file, creating parent dirs."""
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


def _project_frontmatter(
    title: str = "Test Project",
    status: str = "active",
    tags: list[str] | None = None,
    updated: str = "2026-05-19",
) -> str:
    tags_str = str(tags or [])
    return f"""---
title: {title}
status: {status}
tags: {tags_str}
updated: {updated}
---

# {title} — Index

Project description here.
"""


def _project_no_frontmatter(title: str = "Test Project") -> str:
    return f"""# {title} — Index

No frontmatter, just content.
"""


def _project_malformed_yaml() -> str:
    return """---
title: Bad
status: {unclosed: yes
tags: [broken
---

Content here.
"""


def _plan_doc(phases: int = 3, done: int = 2) -> str:
    """Generate a plan document with checkboxes."""
    lines = ["# Plan"]
    for i in range(1, phases + 1):
        lines.append(f"\n### Phase {i}")
        for j in range(1, 4):
            checked = j <= done // max(phases, 1) + (1 if i <= done % max(phases, 1) else 0)
            # Distribute done across phases
            is_done = (i - 1) * 3 + j <= done
            prefix = "- [x]" if is_done else "- [ ]"
            lines.append(f"{prefix} Task {i}.{j}")
    return "\n".join(lines)


# ── Basic Parsing Tests ───────────────────────────────────────────────────


class TestVaultBasic:
    """Tests for basic project parsing."""

    @pytest.mark.asyncio
    async def test_parses_valid_project(self, temp_vault: Path, project_dir: Path):
        """A valid project with frontmatter should be parsed correctly."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter(title="Test Project", status="active"))
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc(phases=3, done=2))

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()

        assert len(projects) == 1
        p = projects[0]
        assert p.name == "Test Project"
        assert p.slug == "test-project"
        assert p.status == "active"
        assert p.phase_count == 9  # 3 phases × 3 tasks each = 9 total checkboxes
        assert p.phases_complete == 2
        assert p.tags == []
        assert p.path.replace("\\", "/") == "04-projects/test-project/project-test-project-index.md"

    @pytest.mark.asyncio
    async def test_multiple_projects(self, temp_vault: Path):
        """Multiple project directories should all be parsed."""
        for name in ["alpha", "beta", "gamma"]:
            proj_dir = temp_vault / "04-projects" / name
            proj_dir.mkdir(parents=True)
            index = proj_dir / f"project-{name}-index.md"
            _write_md(index, _project_frontmatter(title=name.capitalize(), status="seed"))
            plan = proj_dir / f"project-{name}-plan.md"
            _write_md(plan, _plan_doc(phases=1, done=0))

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()

        assert len(projects) == 3
        slugs = [p.slug for p in projects]
        assert slugs == ["alpha", "beta", "gamma"]  # sorted

    @pytest.mark.asyncio
    async def test_missing_frontmatter_extracts_title_from_h1(self, temp_vault: Path, project_dir: Path):
        """Missing frontmatter should fall back to H1 title extraction."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_no_frontmatter(title="Test Project"))
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc())

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()

        assert len(projects) == 1
        assert projects[0].name == "Test Project"
        assert projects[0].status == "seed"  # default

    @pytest.mark.asyncio
    async def test_missing_frontmatter_no_h1(self, temp_vault: Path, project_dir: Path):
        """A file with no frontmatter and no H1 should return None and be skipped."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, "Just some text without an H1 header.")
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc())

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()
        assert len(projects) == 0

    @pytest.mark.asyncio
    async def test_malformed_yaml_skipped_gracefully(self, temp_vault: Path, project_dir: Path):
        """Malformed YAML frontmatter should cause the project to be skipped."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_malformed_yaml())
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc())

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()
        assert len(projects) == 0

    @pytest.mark.asyncio
    async def test_empty_file_skipped(self, temp_vault: Path, project_dir: Path):
        """Empty index file should be skipped."""
        index = project_dir / "project-test-project-index.md"
        index.write_text("", encoding="utf-8")
        # No plan file — only empty index, so no project should be returned

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()
        assert len(projects) == 0

    @pytest.mark.asyncio
    async def test_no_plan_file(self, temp_vault: Path, project_dir: Path):
        """Missing plan file should result in zero phases."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter())

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()

        assert len(projects) == 1
        assert projects[0].phase_count == 0
        assert projects[0].phases_complete == 0
        assert projects[0].last_action is None
        assert projects[0].next_step is None

    @pytest.mark.asyncio
    async def test_missing_projects_dir(self, temp_vault: Path):
        """Missing 04-projects directory should return empty list."""
        # Remove the projects dir
        import shutil
        shutil.rmtree(temp_vault / "04-projects")

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()
        assert projects == []

    @pytest.mark.asyncio
    async def test_empty_projects_dir(self, temp_vault: Path):
        """Empty 04-projects directory should return empty list."""
        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()
        assert projects == []


# ── Path Traversal Tests ──────────────────────────────────────────────────


class TestVaultPathTraversal:
    """Tests for path traversal protection."""

    @pytest.mark.skipif(sys.platform == "win32", reason="symlinks require admin privileges on Windows")
    @pytest.mark.asyncio
    async def test_blocks_path_traversal_symlink(self, temp_vault: Path):
        """A symlink pointing outside the vault should be blocked by validate_path."""
        # Create a file outside the vault
        outside = temp_vault.parent / "secrets.txt"
        outside.write_text("secret", encoding="utf-8")

        # Create a symlink inside projects dir that points outside
        symlink_target = temp_vault / "04-projects" / "evil-link"
        symlink_target.symlink_to(outside)

        reader = VaultReader(str(temp_vault))

        # validate_path should return False for the symlink
        assert reader._validate_path(symlink_target) is False

    @pytest.mark.asyncio
    async def test_blocks_absolute_path_traversal(self, temp_vault: Path):
        """.. components in path should resolve inside vault, so this should be safe."""
        reader = VaultReader(str(temp_vault))

        # Path like 04-projects/../something stays inside vault after resolve
        safe = reader._validate_path(temp_vault / "04-projects" / "..")
        # After resolve, .. goes back to temp_vault which IS relative to root
        # Actually, resolved temp_vault/04-projects/.. = temp_vault, which IS relative to temp_vault
        # So this is actually valid! The traversal protection works by checking resolved path
        # is_relative_to root, so any resolved path that stays within root is fine.

        assert safe is True

    @pytest.mark.asyncio
    async def test_blocks_external_path(self, temp_vault: Path):
        """An external absolute path should be blocked."""
        reader = VaultReader(str(temp_vault))

        # Path outside the vault
        outside = Path("/etc/passwd")
        assert reader._validate_path(outside) is False

    @pytest.mark.asyncio
    async def test_path_traversal_in_parse_frontmatter(self, temp_vault: Path, project_dir: Path):
        """_parse_frontmatter should reject traversal paths."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter())

        reader = VaultReader(str(temp_vault))

        # Try to parse a file outside the vault
        outside = temp_vault.parent / "outside.md"
        outside.write_text("nothing", encoding="utf-8")

        result = reader._parse_frontmatter(outside)
        assert result is None

    @pytest.mark.skipif(sys.platform == "win32", reason="symlinks require admin privileges on Windows")
    @pytest.mark.asyncio
    async def test_skips_invalid_entry_in_get_all_projects(self, temp_vault: Path, project_dir: Path):
        """get_all_projects should skip entries that fail validation."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter())
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc())

        # Add a symlink that points outside
        outside = temp_vault.parent / "outside.md"
        outside.write_text("", encoding="utf-8")
        evil_link = temp_vault / "04-projects" / "evil-link"
        evil_link.symlink_to(outside)

        reader = VaultReader(str(temp_vault))
        projects = reader.get_all_projects()

        # Only the real project should be returned
        assert len(projects) == 1
        assert projects[0].slug == "test-project"


# ── Cache & Delta Detection Tests ─────────────────────────────────────────


class TestVaultCache:
    """Tests for cache TTL and delta detection."""

    @pytest.mark.asyncio
    async def test_cache_returns_same_results_on_second_call(self, temp_vault: Path, project_dir: Path):
        """Cache should return identical results without re-scanning."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter(title="Test Project"))
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc(phases=3, done=1))

        reader = VaultReader(str(temp_vault))
        projects1 = reader.get_all_projects()

        # Second call — should hit cache (no file changes, TTL hasn't expired)
        projects2 = reader.get_all_projects()

        assert projects2 == projects1
        assert projects2[0].name == "Test Project"

    @pytest.mark.asyncio
    async def test_cache_expires_after_ttl(self, temp_vault: Path, project_dir: Path):
        """After cache TTL expires, re-scan should pick up changes."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter(title="Original"))
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc())

        reader = VaultReader(str(temp_vault))
        projects1 = reader.get_all_projects()
        assert projects1[0].name == "Original"

        # Modify file
        _write_md(index, _project_frontmatter(title="Updated"))

        # Force cache expiry by setting TTL to 0
        reader._cache_ttl = 0
        reader._cache_ts = 0

        projects2 = reader.get_all_projects()
        assert projects2[0].name == "Updated"

    @pytest.mark.asyncio
    async def test_delta_detection_detects_size_change(self, temp_vault: Path, project_dir: Path):
        """Changing file content should be detected via size change."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter(title="Original"))
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc())

        reader = VaultReader(str(temp_vault))
        reader.get_all_projects()  # Scan once to cache signatures

        path_str = str(index)
        sig_before = reader._file_signatures.get(path_str)
        assert sig_before is not None

        # Modify file (different content = different size)
        _write_md(index, _project_frontmatter(title="Original", tags=["new"]))

        reader._cache_ttl = 0
        assert reader._has_changed(index) is True

    @pytest.mark.asyncio
    async def test_new_file_detected(self, temp_vault: Path, project_dir: Path):
        """A new file should be detected as changed (no previous signature)."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter())

        reader = VaultReader(str(temp_vault))
        # First call — file is new, _has_changed should return True
        # and cache the signature
        assert reader._has_changed(index) is True
        assert str(index) in reader._file_signatures

        # Second call — no change
        assert reader._has_changed(index) is False

    @pytest.mark.asyncio
    async def test_deleted_file_clears_signature(self, temp_vault: Path, project_dir: Path):
        """Deleted files should have their signature cleared."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter())

        reader = VaultReader(str(temp_vault))
        reader.get_all_projects()  # Cache signatures
        assert str(index) in reader._file_signatures

        # Delete the file
        index.unlink()
        reader._clear_signature(index)

        assert str(index) not in reader._file_signatures

    @pytest.mark.asyncio
    async def test_file_signature_contains_all_fields(self, temp_vault: Path, project_dir: Path):
        """File signature should contain mtime, size, and hash."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter())

        reader = VaultReader(str(temp_vault))
        sig = reader._get_file_signature(index)

        assert sig is not None
        assert "mtime" in sig
        assert "size" in sig
        assert "hash" in sig
        assert sig["size"] > 0
        assert len(sig["hash"]) == 32  # MD5 hex digest

    @pytest.mark.asyncio
    async def test_nonexistent_file_signature(self, temp_vault: Path):
        """Nonexistent file should return None signature."""
        reader = VaultReader(str(temp_vault))
        sig = reader._get_file_signature(temp_vault / "nonexistent.md")
        assert sig is None

    @pytest.mark.asyncio
    async def test_invalidate_if_stale_clears_cache(self, temp_vault: Path, project_dir: Path):
        """_invalidate_if_stale should clear cache when TTL expired."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, _project_frontmatter())

        reader = VaultReader(str(temp_vault))
        reader.get_all_projects()  # Populate cache
        assert len(reader._cache) > 0
        assert len(reader._file_signatures) > 0

        reader._cache_ttl = 0
        reader._cache_ts = 0  # Force staleness so now - 0 > 0 is True
        reader._invalidate_if_stale()

        assert len(reader._cache) == 0
        assert len(reader._file_signatures) == 0


# ── Find Project File Tests ───────────────────────────────────────────────


class TestVaultFindProject:
    """Tests for _find_project_file logic."""

    @pytest.mark.asyncio
    async def test_finds_index_file(self, project_dir: Path):
        """Should find project-*-index.md files."""
        path = _write_md(project_dir / "project-test-project-index.md", "# Hello")
        reader = VaultReader(str(project_dir.parent.parent))
        found = reader._find_project_file(project_dir)
        assert str(found) == str(path)

    @pytest.mark.asyncio
    async def test_finds_prd_file(self, project_dir: Path):
        """Should find project-*-prd.md if no index exists."""
        path = _write_md(project_dir / "project-test-project-prd.md", "# PRD")
        reader = VaultReader(str(project_dir.parent.parent))
        found = reader._find_project_file(project_dir)
        assert str(found) == str(path)

    @pytest.mark.asyncio
    async def test_returns_none_if_no_match(self, project_dir: Path):
        """Should return None if no matching file pattern found."""
        _write_md(project_dir / "random-file.md", "# Random")
        reader = VaultReader(str(project_dir.parent.parent))
        found = reader._find_project_file(project_dir)
        assert found is None

    @pytest.mark.asyncio
    async def test_skips_empty_files(self, project_dir: Path):
        """Should skip empty files and look for next match."""
        _write_md(project_dir / "project-test-project-index.md", "")  # empty
        path = _write_md(project_dir / "project-test-project-prd.md", "# PRD content")
        reader = VaultReader(str(project_dir.parent.parent))
        found = reader._find_project_file(project_dir)
        assert str(found) == str(path)


# ── Phase & Action Scanning Tests ─────────────────────────────────────────


class TestVaultScanning:
    """Tests for phase scanning and action extraction."""

    @pytest.mark.asyncio
    async def test_scan_phases_counts_correctly(self, project_dir: Path):
        """_scan_phases should count total checkboxes and completed checkboxes (format-agnostic)."""
        plan = project_dir / "project-test-project-plan.md"
        _write_md(plan, _plan_doc(phases=4, done=5))

        reader = VaultReader(str(project_dir.parent.parent))
        total, done = reader._scan_phases(project_dir)
        assert total == 12  # 4 phases × 3 tasks each = 12 total checkboxes
        assert done == 5

    @pytest.mark.asyncio
    async def test_find_last_action(self, project_dir: Path):
        """_find_last_action should return the last completed checkbox."""
        plan = project_dir / "project-test-project-plan.md"
        content = """# Plan

### Phase 1
- [x] First done
- [ ] Todo

### Phase 2
- [x] Last done
"""
        _write_md(plan, content)

        reader = VaultReader(str(project_dir.parent.parent))
        action = reader._find_last_action(project_dir)
        assert action == "Last done"

    @pytest.mark.asyncio
    async def test_find_next_step(self, project_dir: Path):
        """_find_next_step should return the first unchecked checkbox."""
        plan = project_dir / "project-test-project-plan.md"
        content = """# Plan

### Phase 1
- [x] Done
- [ ] First todo
- [ ] Second todo
"""
        _write_md(plan, content)

        reader = VaultReader(str(project_dir.parent.parent))
        step = reader._find_next_step(project_dir)
        assert step == "First todo"

    @pytest.mark.asyncio
    async def test_find_next_step_returns_none_when_all_done(self, project_dir: Path):
        """If all tasks are done, next_step should be None."""
        plan = project_dir / "project-test-project-plan.md"
        content = """# Plan

### Phase 1
- [x] All done
"""
        _write_md(plan, content)

        reader = VaultReader(str(project_dir.parent.parent))
        step = reader._find_next_step(project_dir)
        assert step is None

    @pytest.mark.asyncio
    async def test_no_plan_returns_none_for_actions(self, project_dir: Path):
        """Without a plan file, last_action and next_step should be None."""
        reader = VaultReader(str(project_dir.parent.parent))
        assert reader._find_last_action(project_dir) is None
        assert reader._find_next_step(project_dir) is None

    @pytest.mark.asyncio
    async def test_scan_phases_format_agnostic_task_headers(self, project_dir: Path):
        """_scan_phases should count checkboxes even with ### Task headers (not ### Phase)."""
        plan = project_dir / "project-test-project-plan.md"
        content = """# Plan

### Task 1: First task
- [x] Done item 1
- [ ] Todo item 2

### Task 2: Second task
- [ ] Todo item 3
"""
        _write_md(plan, content)

        reader = VaultReader(str(project_dir.parent.parent))
        total, done = reader._scan_phases(project_dir)
        assert total == 3  # 1 checked + 2 unchecked
        assert done == 1   # 1 checked

    @pytest.mark.asyncio
    async def test_scan_phases_flat_checkboxes_no_headers(self, project_dir: Path):
        """_scan_phases should count checkboxes with no section headers at all."""
        plan = project_dir / "project-test-project-plan.md"
        content = """# Plan

- [x] Setup repos
- [x] Configure CI
- [ ] Deploy staging
- [ ] Deploy production
"""
        _write_md(plan, content)

        reader = VaultReader(str(project_dir.parent.parent))
        total, done = reader._scan_phases(project_dir)
        assert total == 4   # 2 checked + 2 unchecked
        assert done == 2    # 2 checked

    @pytest.mark.asyncio
    async def test_scan_phases_acceptance_criteria_not_broken(self, project_dir: Path):
        """_scan_phases should count checkboxes inside ### Phase N Acceptance Criteria."""
        plan = project_dir / "project-test-project-plan.md"
        content = """# Plan

### Phase 0
- [x] Task A
- [ ] Task B

### Phase 0 Acceptance Criteria
- [x] Criterion 1
- [ ] Criterion 2

### Phase 1
- [ ] Task C
"""
        _write_md(plan, content)

        reader = VaultReader(str(project_dir.parent.parent))
        total, done = reader._scan_phases(project_dir)
        assert total == 5   # all checkboxes: 2 checked + 3 unchecked
        assert done == 2    # Task A + Criterion 1


# ── H1 Title Extraction Tests ─────────────────────────────────────────────


class TestVaultH1Extraction:
    """Tests for H1 title extraction from files without frontmatter."""

    @pytest.mark.asyncio
    async def test_extracts_title_from_h1(self, project_dir: Path):
        """Should extract title from H1 when no frontmatter exists."""
        index = project_dir / "project-test-project-index.md"
        content = "# My Project — Index\n\nSome content."
        _write_md(index, content)

        reader = VaultReader(str(project_dir.parent.parent))
        fm = reader._parse_frontmatter(index)
        assert fm == {"title": "My Project"}

    @pytest.mark.asyncio
    async def test_strips_suffix_from_h1(self, project_dir: Path):
        """Should strip known suffixes like '— PRD', '— Index' from title."""
        cases = [
            ("# Project Alpha — PRD", "Project Alpha"),
            ("# Project Beta — Index", "Project Beta"),
            ("# Project Gamma — Architecture", "Project Gamma"),
            ("# Project Delta — Plan", "Project Delta"),
            ("# Project Epsilon — AI Rules", "Project Epsilon"),
        ]
        for h1, expected in cases:
            index = project_dir / f"project-test-{expected.lower().replace(' ', '-')}-index.md"
            content = h1 + "\n\nContent."
            _write_md(index, content)
            reader = VaultReader(str(project_dir.parent.parent))
            fm = reader._parse_frontmatter(index)
            assert fm == {"title": expected}, f"Failed for: {h1}"

    @pytest.mark.asyncio
    async def test_no_h1_returns_none(self, project_dir: Path):
        """A file with no H1 and no frontmatter should return None."""
        index = project_dir / "project-test-project-index.md"
        _write_md(index, "No headers here at all.\n\nJust text.")

        reader = VaultReader(str(project_dir.parent.parent))
        fm = reader._parse_frontmatter(index)
        assert fm is None
