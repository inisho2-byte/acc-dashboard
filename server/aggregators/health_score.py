"""Health Score Engine — Composite 0-100 dashboard health score.

Score breakdown:
  - Sessions trend: 20pts (normalized vs 7-day average)
  - Error frequency: 20pts (fewer errors = higher score)
  - Project staleness: 20pts (fewer stale projects = higher)
  - Skill utilization: 20pts (fewer unused skills = higher)
  - Vault growth: 20pts (growth = healthy)
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("acc-dashboard")


class HealthScoreEngine:
    """Compute composite dashboard health score from trends and live data."""

    def compute_score(
        self,
        trends: list[dict[str, Any]],
        projects: list[Any],
        skills: list[dict[str, Any]],
        vault_vitals: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Compute health score and recommendations.

        Args:
            trends: Output from /api/trends (session + error data).
            projects: List of project statuses.
            skills: List of skill dicts (with heat field).
            vault_vitals: Output from /api/vault/vitals (optional).

        Returns:
            Dict with score (0-100), breakdown per category, and top 3 recommendations.
        """
        breakdown: dict[str, dict[str, Any]] = {}

        # ── Sessions trend (20pts) ──────────────────────────────────
        session_data = trends.get("sessions", {}).get("points", [])
        if len(session_data) >= 2:
            latest = session_data[-1].get("value", 0)
            prev = session_data[-2].get("value", 0)
            if prev > 0:
                ratio = min(max(latest / prev, 0), 2.0)
                score = min(20, max(0, int(ratio * 10)))
            else:
                score = 10 if latest > 0 else 0
        elif session_data:
            score = 10  # Some data but can't compute trend
        else:
            score = 5  # No data
        breakdown["sessions"] = {"score": score, "max": 20, "detail": f"{len(session_data)} data points"}

        # ── Error frequency (20pts) ─────────────────────────────────
        error_data = trends.get("errors", {}).get("points", [])
        total_errors = sum(p.get("value", 0) for p in error_data) if error_data else 0
        total_sessions = sum(p.get("value", 0) for p in session_data) if session_data else 0
        if total_sessions > 0:
            error_rate = min(total_errors / total_sessions, 1.0)
            error_score = max(0, int(20 * (1 - error_rate)))
        else:
            error_score = 10  # No sessions to compare
        breakdown["errors"] = {
            "score": error_score,
            "max": 20,
            "detail": f"error_rate={total_errors}/{total_sessions}",
        }

        # ── Project staleness (20pts) ───────────────────────────────
        if projects:
            total = len(projects)
            # Count projects with status indicating staleness (no update in 7+ days)
            stale = 0
            for p in projects:
                updated = getattr(p, "updated", "") or ""
                if not updated:
                    stale += 1
                    continue
                try:
                    updated_dt = datetime.fromisoformat(updated)
                    days_since = (datetime.now(timezone.utc) - updated_dt).days
                    if days_since > 7:
                        stale += 1
                except (ValueError, TypeError):
                    stale += 1
            freshness_ratio = max(0, (total - stale) / total) if total > 0 else 0
            project_score = int(20 * freshness_ratio)
        else:
            project_score = 5  # No projects
            total = 0
            stale = 0
        breakdown["projects"] = {
            "score": project_score,
            "max": 20,
            "detail": f"stale={stale}/{total}",
        }

        # ── Skill utilization (20pts) ────────────────────────────────
        if skills:
            total_skills = len(skills)
            unused = sum(1 for s in skills if s.get("heat") == "red")
            util_ratio = max(0, (total_skills - unused) / total_skills) if total_skills > 0 else 0
            skill_score = int(20 * util_ratio)
        else:
            skill_score = 5  # No skills data
            total_skills = 0
            unused = 0
        breakdown["skills"] = {
            "score": skill_score,
            "max": 20,
            "detail": f"unused={unused}/{total_skills}",
        }

        # ── Vault growth (20pts) ────────────────────────────────────
        if vault_vitals:
            entity_count = vault_vitals.get("entity_count", 0)
            growth_rate = vault_vitals.get("growth_rate", None)
            if growth_rate is not None and growth_rate > 0:
                vault_score = min(20, max(5, int(10 + growth_rate)))
            elif entity_count > 0:
                vault_score = 10  # Vault exists but not growing
            else:
                vault_score = 2  # Empty vault
        else:
            vault_score = 3  # No vitals data
        breakdown["vault"] = {
            "score": vault_score,
            "max": 20,
            "detail": f"entities={vault_vitals.get('entity_count', '?') if vault_vitals else 'N/A'}",
        }

        total_score = sum(b["score"] for b in breakdown.values())

        # ── Recommendations (top 3 from lowest-scoring categories) ──
        recommendations: list[dict[str, Any]] = []
        sorted_cats = sorted(breakdown.items(), key=lambda x: x[1]["score"] / max(x[1]["max"], 1))
        rec_map = {
            "sessions": ("Increase session activity", "Sessions have been declining. Consider running more frequent agent interactions.", "warning"),
            "errors": ("Reduce error frequency", "Error rate is high. Check agent logs for recurring failures.", "critical"),
            "projects": ("Update stale projects", "Some projects haven't been updated in 7+ days. Review and update project plans.", "warning"),
            "skills": ("Utilize dormant skills", "Several skills are unused (red heat). Trigger underused skills to improve utilization.", "info"),
            "vault": ("Grow the knowledge base", "Vault growth has stalled. Add new notes and entities to keep knowledge fresh.", "info"),
        }
        for cat_name, cat_data in sorted_cats[:3]:
            ratio = cat_data["score"] / max(cat_data["max"], 1)
            if ratio < 0.75:  # Only recommend if scoring below 75%
                rec = rec_map.get(cat_name, (f"Improve {cat_name}", f"Score: {cat_data['score']}/{cat_data['max']}", "info"))
                recommendations.append({
                    "category": cat_name,
                    "message": rec[0],
                    "detail": rec[1],
                    "severity": rec[2],
                })

        return {
            "score": total_score,
            "breakdown": breakdown,
            "recommendations": recommendations[:3],
            "computed_at": datetime.now(timezone.utc).isoformat(),
        }