from __future__ import annotations

import asyncio
import logging
import os
import signal
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Query, Request, HTTPException, Security
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from server.agents.hermes_adapter import HermesAdapter
from server.agents.shu_adapter import ShuDiscordAdapter
from server.agents.claude_code_adapter import ClaudeCodeAdapter
from server.aggregators.activity_engine import ActivityEngine
from server.aggregators.briefing import BriefingGenerator
from server.aggregators.claude_code_reader import ClaudeCodeReader
from server.aggregators.context_engine import ContextEngine
from server.aggregators.cron_dashboard import CronDashboard
from server.aggregators.dispatch import dispatch_to_arete, dispatch_to_shu
from server.aggregators.health_score import HealthScoreEngine
from server.aggregators.ibcb_reader import IBCBReader  # aliased TailscaleMailboxReader
from server.aggregators.memory_reader import MemoryReader
from server.aggregators.pipeline_engine import PipelineEngine
from server.aggregators.search_engine import SearchEngine
from server.aggregators.vault_analytics import VaultAnalytics
from server.events import get_event_bus
from server.models import DashboardHealth, AgentStatus
from server.models import ClaudeSession, ClaudeTask, ClaudePlan, ClaudeFileChange
from server.vault import VaultReader
from server.utils.circuit_breaker import CircuitBreaker, CircuitState, CircuitOpenError

router = APIRouter(tags=["health"])
admin_router = APIRouter(tags=["admin"], prefix="/admin")

# Bearer token auth for admin endpoints (token from ACC_ADMIN_TOKEN env var)
security = HTTPBearer(auto_error=False)

# Rate limiting — applied via slowapi decorator.
# The limiter is created in main.py and imported here lazily after app startup.
# We use a module-level variable that gets set during init_adapters().
_rate_limiter = None  # Set to slowapi.Limiter instance during app startup

# Rate limiter — same instance as main.py. Used for per-route override decorators.
# The default limit (100/min) is set in main.py. Override specific routes here.

# Lazy-init adapters — configured on first call via app.state
_hermes: HermesAdapter | None = None
_shu: ShuDiscordAdapter | None = None
_vault: VaultReader | None = None
_activity: ActivityEngine | None = None
_briefing: BriefingGenerator | None = None
_search: SearchEngine | None = None
_ibcb: IBCBReader | None = None
_context: ContextEngine | None = None
_memory: MemoryReader | None = None
_pipeline: PipelineEngine | None = None
_health_score: HealthScoreEngine | None = None
_vault_analytics: VaultAnalytics | None = None
_cron_dashboard: CronDashboard | None = None
_claude: ClaudeCodeAdapter | None = None
_claude_reader: ClaudeCodeReader | None = None
_discord_cfg: dict = {}

_start_time = datetime.now(timezone.utc)


def init_adapters(hermes_url: str, discord_cfg: dict, vault_path: str, claude_cfg: dict | None = None) -> None:
    global _hermes, _shu, _vault, _activity, _briefing, _search, _ibcb, _discord_cfg
    global _context, _memory, _pipeline, _health_score, _vault_analytics, _cron_dashboard
    global _claude, _claude_reader
    import logging
    logger = logging.getLogger("acc-dashboard")

    # Hermes adapter — attempt health check at startup
    _hermes = HermesAdapter(hermes_url)
    try:
        # Quick connectivity check (handled by a lightweight call that will fail fast)
        import asyncio
        # Hermes health is checked on first actual use — no blocking here
        logger.info("hermes_adapter_initialized", extra={"url": hermes_url})
    except Exception as exc:
        logger.warning("hermes_unreachable_at_startup", extra={"url": hermes_url, "error": str(exc)})

    # Shu adapter
    _shu = ShuDiscordAdapter(
        channel_id=discord_cfg.get("shu_channel_id", ""),
        env_token_var=discord_cfg.get("env_token_var", "DISCORD_BOT_TOKEN"),
    )
    if not _shu._token:
        logger.warning(
            "shu_discord_token_missing",
            extra={"channel_id": discord_cfg.get("shu_channel_id", "")},
        )

    # Vault reader
    vault_path_obj = Path(vault_path)
    if not vault_path_obj.is_dir():
        logger.warning("vault_path_not_found", extra={"vault_path": vault_path})
    _vault = VaultReader(vault_path)
    logger.info("vault_reader_initialized", extra={"vault_path": vault_path})

    _activity = ActivityEngine(_hermes, _shu, vault=_vault, claude_reader=_claude_reader)
    _briefing = BriefingGenerator(_activity, _vault)
    _search = SearchEngine(_hermes, _shu, vault_path=vault_path, discord_cfg=discord_cfg)
    _context = ContextEngine(_hermes, _shu)
    _memory = MemoryReader(_hermes, _shu)
    _ibcb = IBCBReader()
    _pipeline = PipelineEngine(_ibcb)
    _health_score = HealthScoreEngine()
    _vault_analytics = VaultAnalytics(vault_path)
    _cron_dashboard = CronDashboard()
    _discord_cfg = discord_cfg

    # Claude Code adapter — filesystem-only, reads from ~/.claude/
    if claude_cfg and claude_cfg.get("enabled", False):
        data_dir = claude_cfg.get("data_dir")
        _claude_reader = ClaudeCodeReader(data_dir=data_dir)
        _claude = ClaudeCodeAdapter(reader=_claude_reader)
        logger.info(
            "claude_code_adapter_initialized",
            extra={"data_dir": str(_claude_reader.data_dir)},
        )
    else:
        _claude = None
        _claude_reader = None


@router.get("/health")
async def get_health() -> DashboardHealth:
    assert _hermes is not None
    assert _shu is not None

    try:
        arete = await _hermes.health()
    except Exception as exc:
        arete = AgentStatus(
            agent_id="arete",
            agent_type="hermes",
            name="ARETE",
            status="offline",
            model="unknown",
            error_message=str(exc),
        )

    try:
        shu = await _shu.health()
    except Exception as exc:
        shu = AgentStatus(
            agent_id="shu",
            agent_type="discord",
            name="Shu",
            status="offline",
            error_message=str(exc),
        )

    claude: AgentStatus | None = None
    try:
        if _claude is not None:
            claude = await _claude.health()
    except Exception as exc:
        claude = AgentStatus(
            agent_id="claude-code",
            agent_type="filesystem",
            name="Claude Code",
            status="offline",
            error_message=str(exc),
        )

    skills = await _hermes.list_skills()

    return DashboardHealth(
        agents={**{"arete": arete, "shu": shu}, **({"claude-code": claude} if claude else {})},
        server_uptime=(datetime.now(timezone.utc) - _start_time).total_seconds(),
        total_sessions=arete.session_count,
        total_skills=len(skills),
    )



@router.get("/health/score")
async def get_health_score():
    """Composite 0-100 dashboard health score with breakdown and recommendations."""
    assert _health_score is not None

    # Gather data from existing endpoints
    from server.db import get_trend

    session_trend = get_trend("total_sessions", days=7)
    error_trend = get_trend("error_count", days=7)
    trends = {
        "sessions": {"points": session_trend},
        "errors": {"points": error_trend},
    }

    # Get projects
    projects = _vault.get_all_projects() if _vault else []

    # Get skills with heat
    skills_raw = []
    if _hermes is not None:
        try:
            skills_raw = await _hermes.list_skills()
            from server.db import get_all_skill_usage
            usage_data = get_all_skill_usage()
            usage_map = {u["skill_name"]: u for u in usage_data}
            from datetime import datetime, timezone
            now = datetime.now(timezone.utc)
            for sk in skills_raw:
                usage = usage_map.get(sk.get("name", ""), None)
                sk["last_used"] = usage["last_used"] if usage else None
                sk["use_count"] = usage["use_count"] if usage else 0
                if sk["last_used"]:
                    try:
                        last_dt = datetime.fromisoformat(sk["last_used"])
                        age = (now - last_dt).total_seconds() / 3600
                        sk["heat"] = "green" if age < 24 else ("yellow" if age < 168 else "red")
                    except (ValueError, TypeError):
                        sk["heat"] = "red"
                else:
                    sk["heat"] = "red"
        except Exception:
            pass

    # Get vault vitals
    vault_vitals = None
    if _vault_analytics is not None:
        try:
            vault_trend = get_trend("vault_entities", days=7)
            vault_vitals = _vault_analytics.get_vitals(trend_data=vault_trend)
        except Exception:
            vault_vitals = None

    return _health_score.compute_score(
        trends=trends,
        projects=projects,
        skills=skills_raw,
        vault_vitals=vault_vitals,
    )

@router.get("/health/{agent_id}")
async def get_agent_health(agent_id: str):
    if agent_id == "arete":
        assert _hermes is not None
        return await _hermes.health()
    if agent_id == "shu":
        assert _shu is not None
        return await _shu.health()
    return {"error": f"Unknown agent: {agent_id}"}


@router.get("/agents/{agent_id}/models")
async def get_agent_models(agent_id: str):
    """Return available models for an agent."""
    import yaml
    config_path = Path(__file__).resolve().parent.parent.parent / "config.yaml"
    models = ["deepseek/deepseek-v4-flash", "anthropic/claude-sonnet-4", "openai/gpt-4.1"]
    if config_path.is_file():
        try:
            with open(config_path) as f:
                cfg = yaml.safe_load(f) or {}
            acc_models = cfg.get("acc", {}).get("models", [])
            if acc_models:
                models = acc_models
        except Exception:
            pass
    return {"agent_id": agent_id, "models": models, "current": None}


@router.post("/agents/{agent_id}/model")
async def set_agent_model(agent_id: str, request: Request):
    """Set the preferred model for an agent. Persists to local config."""
    import json as _json
    body = await request.json()
    model = body.get("model")
    if not model:
        raise HTTPException(status_code=400, detail="model field required")
    prefs_dir = Path.home() / ".hermes" / "acc"
    prefs_dir.mkdir(parents=True, exist_ok=True)
    prefs_file = prefs_dir / "model_preferences.json"
    prefs = {}
    if prefs_file.is_file():
        try:
            prefs = _json.loads(prefs_file.read_text())
        except Exception:
            prefs = {}
    prefs[agent_id] = model
    prefs_file.write_text(_json.dumps(prefs, indent=2))
    # Also publish SSE event
    bus = get_event_bus()
    await bus.publish("agent_status", {
        "agent_id": agent_id,
        "model": model,
        "model_swap_pending": True,
    })
    return {"agent_id": agent_id, "model": model, "status": "preference_saved", "note": "Model preference saved. Restart Hermes agent to apply."}


@router.get("/sessions")
async def get_sessions(limit: int = 10):
    assert _hermes is not None
    assert _shu is not None

    arete_sessions = await _hermes.recent_sessions(limit)
    shu_sessions = await _shu.recent_sessions(limit)

    # Merge and sort by last_active desc
    merged = arete_sessions + shu_sessions
    merged.sort(key=lambda s: s.last_active, reverse=True)
    return merged[:limit]


@router.get("/sessions/{agent_id}")
async def get_agent_sessions(agent_id: str, limit: int = 10):
    assert _hermes is not None
    assert _shu is not None

    if agent_id == "arete":
        return await _hermes.recent_sessions(limit)
    if agent_id == "shu":
        return await _shu.recent_sessions(limit)
    return {"error": f"Unknown agent: {agent_id}"}


@router.get("/errors")
async def get_errors(limit: int = 10):
    assert _hermes is not None
    assert _shu is not None

    arete_errs = await _hermes.recent_errors(limit)
    shu_errs = await _shu.recent_errors(limit)

    merged = arete_errs + shu_errs
    merged.sort(key=lambda e: e.timestamp, reverse=True)
    return merged[:limit]


@router.get("/skills")
async def get_skills():
    """Get all installed skills with usage metrics and heat classification."""
    assert _hermes is not None
    skills = await _hermes.list_skills()
    # Merge usage metrics from usage.db
    from server.db import get_all_skill_usage
    from datetime import datetime, timezone, timedelta
    try:
        usage_data = get_all_skill_usage()
        usage_map = {u["skill_name"]: u for u in usage_data}
    except Exception:
        usage_map = {}
    now = datetime.now(timezone.utc)
    for sk in skills:
        usage = usage_map.get(sk.get("name", ""), None)
        sk["last_used"] = usage["last_used"] if usage else None
        sk["use_count"] = usage["use_count"] if usage else 0
        # Compute heat classification
        if sk["last_used"]:
            try:
                last_dt = datetime.fromisoformat(sk["last_used"])
                # Session logs store naive timestamps (local time, not UTC).
                # If the datetime is naive, assume UTC to avoid TypeError
                # when subtracting from the UTC-aware `now`.
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                age = (now - last_dt).total_seconds() / 3600  # hours
                if age < 24:
                    sk["heat"] = "green"
                elif age < 168:  # 7 days
                    sk["heat"] = "yellow"
                else:
                    sk["heat"] = "red"
            except (ValueError, TypeError):
                sk["heat"] = "red"
        else:
            sk["heat"] = "red"
    return skills


@router.get("/cron")
async def get_cron():
    assert _hermes is not None
    return await _hermes.list_cron_jobs()


@router.get("/projects")
async def get_projects():
    assert _vault is not None
    return _vault.get_all_projects()


@router.get("/activity")
async def get_activity(
    limit: int = Query(50, le=200),
    agent_id: str | None = Query(None),
    event_type: str | None = Query(None),
):
    assert _activity is not None
    return await _activity.get_timeline(
        limit=limit,
        agent_id=agent_id,
        event_type=event_type,
    )


@router.get("/activity/{agent_id}")
async def get_agent_activity(
    agent_id: str,
    limit: int = Query(50, le=200),
    event_type: str | None = Query(None),
):
    assert _activity is not None
    return await _activity.get_timeline(
        limit=limit,
        agent_id=agent_id,
        event_type=event_type,
    )


@router.get("/briefing")
async def get_briefing(
    hours: int = Query(24, le=168),
    since: str | None = Query(None, description="ISO timestamp for 'since last checkin'"),
):
    assert _briefing is not None
    if since:
        try:
            since_dt = datetime.fromisoformat(since)
        except (ValueError, TypeError):
            return {"error": "Invalid since parameter. Use ISO timestamp format."}
        return await _briefing.generate(since=since_dt)
    return await _briefing.generate(hours=hours)


@router.get("/context-gaps")
async def get_context_gaps(limit: int = Query(50, le=200)):
    """Surface knowledge gaps between ARETE and Shu agents."""
    assert _context is not None
    return await _context.get_gaps(limit=limit)


@router.get("/memory/{agent_id}")
async def get_agent_memory(agent_id: str):
    """Read an agent's working memory."""
    assert _memory is not None
    if agent_id == "arete":
        return await _memory.get_arete_memory()
    elif agent_id == "shu":
        return await _memory.get_shu_memory()
    return {"error": f"Unknown agent: {agent_id}"}


@router.get("/search")
async def search(
    q: str = Query(..., min_length=2),
    limit: int = Query(20, le=50),
    source: str | None = Query(None),
):
    assert _search is not None
    return await _search.search(query=q, limit=limit, source=source)


@router.post("/search/rebuild")
async def rebuild_search_index(request: Request):
    assert _search is not None
    counts = await _search.rebuild()
    return {"indexed": counts}


@router.get("/mailbox")
async def get_mailbox_feed(limit: int = Query(30, le=100)):
    assert _ibcb is not None
    return _ibcb.get_feed(limit=limit)


@router.get("/mailbox/stats")
async def get_mailbox_stats():
    assert _ibcb is not None
    return _ibcb.get_stats()


@router.get("/trading")
async def get_trading_feed(limit: int = Query(50, le=200)):
    """Trading messages only — forex briefs and spike alerts from shu-trading."""
    assert _ibcb is not None
    return _ibcb.get_trading_feed(limit=limit)


@router.get("/ibcb")
async def get_ibcb_feed(limit: int = Query(30, le=100)):
    """Deprecated — use /mailbox instead."""
    assert _ibcb is not None
    return _ibcb.get_feed(limit=limit)


@router.get("/ibcb/stats")
async def get_ibcb_stats():
    """Deprecated — use /mailbox/stats instead."""
    assert _ibcb is not None
    return _ibcb.get_stats()


@router.get("/pipeline")
async def get_pipeline(limit: int = Query(10, le=50)):
    """Get the current multi-agent pipeline state derived from Tailscale mailbox messages."""
    assert _pipeline is not None
    return _pipeline.get_pipeline(limit=limit)


@router.post("/dispatch")
async def dispatch(
    request: Request,
    agent: str = Query(...),
    task: str = Query(..., min_length=2),
    skills: str | None = Query(None),
):
    """Send a task to an agent. agent=arete or shu."""
    bus = get_event_bus()
    if agent == "arete":
        result = await dispatch_to_arete(task, skills=skills)
        await bus.publish("dispatch", {
            "agent_id": "arete",
            "task": task,
            "success": result.get("success", False),
            "session_id": result.get("session_id", ""),
            "error": result.get("error"),
        })
        return result
    elif agent == "shu":
        assert _shu is not None
        cfg = _discord_cfg
        result = await dispatch_to_shu(task, cfg.get("shu_channel_id", ""), _shu._token)
        await bus.publish("dispatch", {
            "agent_id": "shu",
            "task": task,
            "success": result.get("success", False),
            "message_id": result.get("message_id", ""),
            "error": result.get("error"),
        })
        return result
    return {"error": f"Unknown agent: {agent}"}


@router.post("/skills/{skill_name}/run")
async def run_skill(skill_name: str, task: str = Query("run", min_length=1)):
    """Trigger a Hermes skill by name."""
    from server.db import track_skill
    result = await dispatch_to_arete(task, skills=skill_name)
    if result.get("success"):
        try:
            track_skill(skill_name)
        except Exception:
            pass  # Usage tracking is best-effort
    return result


@router.get("/monitoring")
async def get_monitoring():
    """Get comprehensive monitoring data: circuit breaker stats, adapter health, error rates.
    
    Returns:
    - circuit_breakers: Status of all circuit breakers (state, stats, retry_after)
    - adapters: Health status for each adapter
    - error_summary: Recent error counts by agent
    - rate_limits: Rate limiter statistics (if available)
    """
    from fastapi import Request
    
    assert _hermes is not None
    assert _shu is not None
    
    # Circuit breaker stats
    circuit_breakers = {}
    
    # Hermes circuit breakers
    for cb_name, cb in [
        ("hermes_health", _hermes._cb_health),
        ("hermes_sessions", _hermes._cb_sessions),
        ("hermes_cron", _hermes._cb_cron),
        ("hermes_skills", _hermes._cb_skills),
        ("hermes_dispatch", _hermes._cb_dispatch),
    ]:
        stats = cb.stats
        circuit_breakers[cb_name] = {
            "state": cb.state.value,
            "total_calls": stats.total_calls,
            "successful_calls": stats.successful_calls,
            "failed_calls": stats.failed_calls,
            "rejected_calls": stats.rejected_calls,
            "state_changes": stats.state_changes,
            "retry_after": cb._get_retry_after() if cb.state == CircuitState.OPEN else 0.0,
        }
    
    # Shu circuit breakers
    for cb_name, cb in [
        ("shu_health", _shu._cb_health),
        ("shu_sessions", _shu._cb_sessions),
    ]:
        stats = cb.stats
        circuit_breakers[cb_name] = {
            "state": cb.state.value,
            "total_calls": stats.total_calls,
            "successful_calls": stats.successful_calls,
            "failed_calls": stats.failed_calls,
            "rejected_calls": stats.rejected_calls,
            "state_changes": stats.state_changes,
            "retry_after": cb._get_retry_after() if cb.state == CircuitState.OPEN else 0.0,
        }
    
    # Adapter health (try to get current status, handle circuit open gracefully)
    adapters = {}
    for agent_id, adapter in [("arete", _hermes), ("shu", _shu)]:
        try:
            status = await adapter.health()
            adapters[agent_id] = {
                "status": status.status,
                "last_active": status.last_active.isoformat() if status.last_active else None,
                "model": status.model,
                "session_count": status.session_count,
            }
        except Exception as exc:
            adapters[agent_id] = {
                "status": "error",
                "error": str(exc),
                "last_active": None,
            }
    
    # Error summary from recent errors
    arete_errors = await _hermes.recent_errors(10)
    shu_errors = await _shu.recent_errors(10)
    
    error_summary = {
        "arete": {
            "recent_count": len(arete_errors),
            "errors": [{"message": e.message, "timestamp": e.timestamp.isoformat()} for e in arete_errors[-5:]],
        },
        "shu": {
            "recent_count": len(shu_errors),
            "errors": [{"message": e.message, "timestamp": e.timestamp.isoformat()} for e in shu_errors[-5:]],
        },
    }
    
    # Rate limit metrics (from slowapi limiter)
    # Note: slowapi doesn't expose metrics directly, so we report configuration
    rate_limits = {
        "enabled": True,
        "limiter_type": "fixed_window",
        "key_func": "remote_address",
        "note": "Rate limit hits tracked in logs - see 'rate_limit_exceeded' events",
    }
    
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "circuit_breakers": circuit_breakers,
        "adapters": adapters,
        "error_summary": error_summary,
        "rate_limits": rate_limits,
    }


# ── Admin Endpoints ──────────────────────────────────────────────

def _verify_admin_token(credentials: HTTPAuthorizationCredentials | None) -> bool:
    """Verify admin bearer token from ACC_ADMIN_TOKEN env var."""
    admin_token = os.environ.get("ACC_ADMIN_TOKEN", "")
    if not admin_token:
        return False  # No admin token configured - admin endpoints disabled
    if credentials is None:
        return False
    return credentials.credentials == admin_token


@admin_router.post("/circuit/{circuit_name}/reset")
async def reset_circuit(
    circuit_name: str,
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> dict:
    """Manually reset a circuit breaker to CLOSED state.
    
    Requires Bearer token authentication via ACC_ADMIN_TOKEN env var.
    
    Valid circuit names:
    - hermes_health, hermes_sessions, hermes_cron
    - shu_health, shu_sessions
    
    Returns:
    - Circuit state after reset
    - Previous state before reset
    
    Raises:
    - 401: Missing or invalid admin token
    - 404: Unknown circuit name
    - 400: Admin endpoints not configured (no ACC_ADMIN_TOKEN)
    """
    if not _verify_admin_token(credentials):
        admin_configured = bool(os.environ.get("ACC_ADMIN_TOKEN", ""))
        if not admin_configured:
            raise HTTPException(
                status_code=400,
                detail="Admin endpoints not configured - set ACC_ADMIN_TOKEN env var",
            )
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")
    
    assert _hermes is not None
    assert _shu is not None
    
    # Map circuit names to breaker instances
    circuits = {
        "hermes_health": _hermes._cb_health,
        "hermes_sessions": _hermes._cb_sessions,
        "hermes_cron": _hermes._cb_cron,
        "hermes_skills": _hermes._cb_skills,
        "hermes_dispatch": _hermes._cb_dispatch,
        "shu_health": _shu._cb_health,
        "shu_sessions": _shu._cb_sessions,
    }
    
    if circuit_name not in circuits:
        valid_names = ", ".join(circuits.keys())
        raise HTTPException(
            status_code=404,
            detail=f"Unknown circuit: {circuit_name}. Valid names: {valid_names}",
        )
    
    circuit = circuits[circuit_name]
    previous_state = circuit.state.value
    
    # Reset the circuit
    circuit.reset()
    
    import logging
    logger = logging.getLogger(__name__)
    logger.info(
        f"Admin reset circuit '{circuit_name}' from {previous_state} to closed",
        extra={"circuit_name": circuit_name, "previous_state": previous_state},
    )
    
    return {
        "circuit_name": circuit_name,
        "previous_state": previous_state,
        "current_state": "closed",
        "message": f"Circuit '{circuit_name}' reset successfully",
    }


@admin_router.post("/kill-switch")
async def kill_switch(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> dict:
    """Kill Switch — shut down the ACC Dashboard server and all background processes.
    
    Requires Bearer token authentication via ACC_ADMIN_TOKEN env var.
    
    This endpoint:
    1. Closes all SSE connections
    2. Stops the uvicorn server gracefully
    3. Kills any background processes managed by the dashboard
    """
    if not _verify_admin_token(credentials):
        admin_configured = bool(os.environ.get("ACC_ADMIN_TOKEN", ""))
        if not admin_configured:
            raise HTTPException(
                status_code=400,
                detail="Admin endpoints not configured - set ACC_ADMIN_TOKEN env var",
            )
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")
    
    logger = logging.getLogger("acc-dashboard.kill-switch")
    logger.critical("KILL SWITCH ACTIVATED — shutting down dashboard server")
    
    # Publish shutdown event to SSE subscribers before dying
    bus = get_event_bus()
    await bus.publish("kill_switch", {"action": "shutdown", "timestamp": datetime.now(timezone.utc).isoformat()})
    
    # Schedule the server to shut down after a short delay to allow the response to be sent
    async def _shutdown():
        await asyncio.sleep(0.5)
        os.kill(os.getpid(), signal.SIGTERM)
    
    asyncio.create_task(_shutdown())
    
    return {"status": "shutting_down", "message": "Kill switch activated. Server shutting down.", "timestamp": datetime.now(timezone.utc).isoformat()}


@admin_router.get("/circuits")
async def list_circuits(
    credentials: HTTPAuthorizationCredentials | None = Security(security),
) -> dict:
    """List all circuit breakers with their current states.
    
    Requires Bearer token authentication via ACC_ADMIN_TOKEN env var.
    
    Returns:
    - List of all circuits with name, state, and stats
    """
    if not _verify_admin_token(credentials):
        admin_configured = bool(os.environ.get("ACC_ADMIN_TOKEN", ""))
        if not admin_configured:
            raise HTTPException(
                status_code=400,
                detail="Admin endpoints not configured - set ACC_ADMIN_TOKEN env var",
            )
        raise HTTPException(status_code=401, detail="Invalid or missing admin token")
    
    assert _hermes is not None
    assert _shu is not None
    
    circuits = []
    for cb_name, cb in [
        ("hermes_health", _hermes._cb_health),
        ("hermes_sessions", _hermes._cb_sessions),
        ("hermes_cron", _hermes._cb_cron),
        ("hermes_skills", _hermes._cb_skills),
        ("hermes_dispatch", _hermes._cb_dispatch),
        ("shu_health", _shu._cb_health),
        ("shu_sessions", _shu._cb_sessions),
    ]:
        stats = cb.stats
        circuits.append({
            "name": cb_name,
            "state": cb.state.value,
            "total_calls": stats.total_calls,
            "successful_calls": stats.successful_calls,
            "failed_calls": stats.failed_calls,
            "rejected_calls": stats.rejected_calls,
            "state_changes": stats.state_changes,
            "retry_after": cb._get_retry_after() if cb.state == CircuitState.OPEN else 0.0,
        })
    
    return {"circuits": circuits, "count": len(circuits)}


# ── SSE Events Endpoint ──────────────────────────────────────────────

@router.get("/events")
async def sse_events(request: Request) -> StreamingResponse:
    """Server-Sent Events stream for real-time dashboard updates.

    Event types:
    - heartbeat: Keep-alive ping (every 15s)
    - state: Full state snapshot (on connect + every 30s)
    - agent_status: Agent online/offline/status change
    - session: New session event
    - error: Agent error event
    - circuit: Circuit breaker state change
    - project: Project status change
    """
    bus = get_event_bus()
    queue = bus.subscribe()

    async def event_stream():
        try:
            # Send initial full state snapshot
            state = await _gather_state()
            yield f"event: state\ndata: {state}\n\n"

            while True:
                if await request.is_disconnected():
                    break
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield event.to_sse()
                except asyncio.TimeoutError:
                    # Heartbeat keep-alive
                    yield f"event: heartbeat\ndata: {{\"ts\":\"{datetime.now(timezone.utc).isoformat()}\"}}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            bus.unsubscribe(queue)

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _gather_state() -> str:
    """Gather full dashboard state for SSE initial snapshot."""
    import json

    data: dict = {"agents": [], "sessions": [], "errors": [], "skills": [], "projects": []}

    try:
        if _hermes is not None:
            health = await _hermes.health()
            data["agents"] = [
                {
                    "id": "arete",
                    "name": health.name,
                    "status": health.status,
                    "model": health.model,
                    "session_count": health.session_count,
                    "current_task": health.current_task,
                }
            ]
    except Exception:
        pass

    try:
        if _shu is not None:
            health = await _shu.health()
            data["agents"].append(
                {
                    "id": "shu",
                    "name": health.name,
                    "status": health.status,
                    "model": health.model,
                    "session_count": health.session_count,
                    "current_task": health.current_task,
                }
            )
    except Exception:
        pass

    try:
        if _claude is not None:
            health = await _claude.health()
            data["agents"].append(
                {
                    "id": "claude-code",
                    "name": health.name,
                    "status": health.status,
                    "model": health.model,
                    "session_count": health.session_count,
                    "current_task": health.current_task,
                }
            )
    except Exception:
        pass

    try:
        sessions: list[dict] = []
        if _hermes is not None:
            sessions += [
                {
                    "id": s.id,
                    "agent_id": s.agent_id,
                    "title": s.title,
                    "preview": s.preview,
                    "last_active": s.last_active.isoformat() if s.last_active else None,
                    "status": s.status,
                    "body": s.body,
                    "author": s.author,
                }
                for s in (await _hermes.recent_sessions(10))
            ]
        if _shu is not None:
            sessions += [
                {
                    "id": s.id,
                    "agent_id": s.agent_id,
                    "title": s.title,
                    "preview": s.preview,
                    "last_active": s.last_active.isoformat() if s.last_active else None,
                    "status": s.status,
                    "body": s.body,
                    "author": s.author,
                }
                for s in (await _shu.recent_sessions(10))
            ]
        if _claude is not None:
            sessions += [
                {
                    "id": s.id,
                    "agent_id": s.agent_id,
                    "title": s.title,
                    "preview": s.preview,
                    "last_active": s.last_active.isoformat() if s.last_active else None,
                    "status": s.status,
                    "body": s.body,
                    "author": s.author,
                }
                for s in (await _claude.recent_sessions(10))
            ]
        sessions.sort(key=lambda s: s["last_active"] or "", reverse=True)
        data["sessions"] = sessions[:20]
    except Exception:
        pass

    try:
        if _vault is not None:
            projects = _vault.get_all_projects()
            data["projects"] = [
                {
                    "name": p.name,
                    "slug": p.slug,
                    "status": p.status,
                    "phase_count": p.phase_count,
                    "phases_complete": p.phases_complete,
                    "next_step": p.next_step,
                    "tags": p.tags,
                }
                for p in projects
            ]
    except Exception:
        pass

    return json.dumps(data, default=str)


# ── Project Detail Endpoint ──────────────────────────────────────────

@router.get("/projects/{slug}")
async def get_project_detail(slug: str):
    """Get detailed information for a specific project.

    Returns:
    - Full project metadata from frontmatter
    - Phase breakdown with completion status
    - Related files in the project directory
    - Next steps and last actions
    """
    assert _vault is not None
    projects = _vault.get_all_projects()

    # Find the target project
    project = None
    for p in projects:
        if p.slug == slug:
            project = p
            break

    if project is None:
        raise HTTPException(status_code=404, detail=f"Project not found: {slug}")

    # A5: Validate slug doesn't contain path traversal
    if ".." in slug or "/" in slug or "\\" in slug:
        raise HTTPException(status_code=400, detail="Invalid project path")

    # Get detailed phase data
    project_dir = _vault._root / "04-projects" / project.path.rsplit("/", 1)[0].rsplit("/", 1)[-1] if "/" in project.path else _vault._root / project.path
    # Try multiple possible directory names
    project_path = Path(_vault._root / project.path) if project.path else None

    # Build phases detail from plan file
    phases: list[dict] = []
    if project_path and project_path.is_file():
        project_dir_path = project_path.parent
    elif project_path:
        project_dir_path = project_path
    else:
        project_dir_path = None

    if project_dir_path and project_dir_path.is_dir():
        plan_file = None
        for fname in sorted(project_dir_path.iterdir()):
            if "plan" in fname.name.lower() and fname.suffix == ".md":
                plan_file = fname
                break

        if plan_file:
            try:
                text = plan_file.read_text(encoding="utf-8")
                current_phase = None
                current_tasks: list[dict] = []
                for line in text.splitlines():
                    stripped = line.strip()
                    if stripped.startswith("### Phase"):
                        if current_phase is not None:
                            phases.append(current_phase)
                        phase_title = stripped[4:].strip()
                        current_phase = {"title": phase_title, "tasks": current_tasks}
                        current_tasks = []
                    elif current_phase is not None:
                        if stripped.startswith("- [x]") or stripped.startswith("- [X]"):
                            current_tasks.append({"text": stripped[5:].strip(), "done": True})
                        elif stripped.startswith("- [ ]"):
                            content = stripped[5:].strip()
                            if content and not content.startswith("<!--"):
                                current_tasks.append({"text": content, "done": False})
                if current_phase is not None:
                    current_phase["tasks"] = current_tasks
                    phases.append(current_phase)
            except OSError:
                pass

    # Get related files
    files: list[str] = []
    if project_dir_path and project_dir_path.is_dir():
        for f in sorted(project_dir_path.iterdir()):
            if f.is_file() and f.suffix == ".md":
                files.append(f.name)

    result = {
        "name": project.name,
        "slug": project.slug,
        "status": project.status,
        "phase_count": project.phase_count,
        "phases_complete": project.phases_complete,
        "tags": project.tags,
        "updated": project.updated,
        "path": project.path,
        "last_action": project.last_action,
        "next_step": project.next_step,
        "phases_detail": phases,
        "files": files,
    }

    return result


# ── Group 4: Analytics & Security Endpoints ────────────────────────────────


@router.get("/skills/usage")
async def get_skills_usage():
    """Get all skill usage data with heat classification, sorted by last_used."""
    from server.db import get_all_skill_usage
    from datetime import datetime, timezone
    try:
        usage_data = get_all_skill_usage()
    except Exception:
        usage_data = []
    now = datetime.now(timezone.utc)
    for u in usage_data:
        if u.get("last_used"):
            try:
                last_dt = datetime.fromisoformat(u["last_used"])
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                age_hours = (now - last_dt).total_seconds() / 3600
                if age_hours < 24:
                    u["heat"] = "green"
                elif age_hours < 168:
                    u["heat"] = "yellow"
                else:
                    u["heat"] = "red"
            except (ValueError, TypeError):
                u["heat"] = "red"
        else:
            u["heat"] = "red"
    return usage_data


@router.get("/trends/sessions")
async def get_session_trends(days: int = Query(7, le=30)):
    """Get 7-day session trend with delta badge."""
    from server.db import get_trend
    points = get_trend("total_sessions", days=days)
    delta = None
    delta_pct = None
    badge = "→"
    if len(points) >= 2:
        latest = points[0].get("value", 0)  # Most recent first (DESC)
        previous = points[1].get("value", 0)
        if previous > 0:
            delta = latest - previous
            delta_pct = round((delta / previous) * 100, 1)
        else:
            delta = latest
            delta_pct = None
        if delta and delta > 0:
            badge = "↑"
        elif delta and delta < 0:
            badge = "↓"
        else:
            badge = "→"
    # Reverse for chronological order
    points.reverse()
    return {"points": points, "delta": delta, "delta_pct": delta_pct, "badge": badge}


@router.get("/trends/errors")
async def get_error_trends(days: int = Query(7, le=30)):
    """Get 7-day error trend with type breakdown."""
    from server.db import get_trend
    points = get_trend("error_count", days=days)
    # Extract type breakdown from metadata
    breakdown = {}
    for p in points:
        meta = p.get("metadata") or {}
        for err_type, count in meta.get("types", {}).items():
            breakdown[err_type] = breakdown.get(err_type, 0) + count

    delta = None
    badge = "→"
    if len(points) >= 2:
        latest = points[0].get("value", 0)
        previous = points[1].get("value", 0)
        delta = latest - previous
        if delta and delta > 0:
            badge = "↑"
        elif delta and delta < 0:
            badge = "↓"
        else:
            badge = "→"
    points.reverse()
    return {"points": points, "delta": delta, "badge": badge, "breakdown": breakdown}


@router.get("/trends")
async def get_trends_combined(days: int = Query(7, le=30)):
    """Combined trends: sessions + errors."""
    from server.db import get_trend
    session_points = get_trend("total_sessions", days=days)
    error_points = get_trend("error_count", days=days)

    # Compute deltas
    s_delta, s_badge = None, "→"
    if len(session_points) >= 2:
        s_delta = session_points[0].get("value", 0) - session_points[1].get("value", 0)
        s_badge = "↑" if s_delta and s_delta > 0 else ("↓" if s_delta and s_delta < 0 else "→")

    e_delta, e_badge = None, "→"
    if len(error_points) >= 2:
        e_delta = error_points[0].get("value", 0) - error_points[1].get("value", 0)
        e_badge = "↑" if e_delta and e_delta > 0 else ("↓" if e_delta and e_delta < 0 else "→")

    # Extract error type breakdown
    breakdown = {}
    for p in error_points:
        meta = p.get("metadata") or {}
        for err_type, count in meta.get("types", {}).items():
            breakdown[err_type] = breakdown.get(err_type, 0) + count

    session_points.reverse()
    error_points.reverse()

    return {
        "sessions": {"points": session_points, "delta": s_delta, "badge": s_badge},
        "errors": {"points": error_points, "delta": e_delta, "badge": e_badge, "breakdown": breakdown},
    }


@router.get("/vault/vitals")
async def get_vault_vitals():
    """Vault vital signs: entity count, growth, top links, stale/orphaned."""
    assert _vault_analytics is not None
    from server.db import get_trend
    trend_data = get_trend("vault_entities", days=7)
    return _vault_analytics.get_vitals(trend_data=trend_data)


@router.get("/cron/dashboard")
async def get_cron_dashboard():
    """Cron execution history, forecast, and per-job success rate."""
    assert _cron_dashboard is not None
    assert _hermes is not None

    # Get current cron jobs from Hermes
    try:
        jobs = await _hermes.list_cron_jobs()
    except Exception:
        jobs = []

    return _cron_dashboard.get_dashboard(jobs)


@router.get("/inference/usage")
async def get_inference_usage():
    """Aggregate token usage from recent sessions. Stub for Nous API integration."""
    assert _hermes is not None
    assert _shu is not None

    total_tokens = 0
    sessions_with = 0
    sessions_without = 0

    try:
        arete_sessions = await _hermes.recent_sessions(50)
        shu_sessions = await _shu.recent_sessions(50)
        all_sessions = arete_sessions + shu_sessions
        for s in all_sessions:
            tc = getattr(s, "token_count", None) or 0
            if tc and tc > 0:
                total_tokens += tc
                sessions_with += 1
            else:
                sessions_without += 1
    except Exception:
        pass

    return {
        "total_tokens": total_tokens,
        "sessions_with_tokens": sessions_with,
        "sessions_without_tokens": sessions_without,
        "estimated_cost": None,
        "note": "Requires Nous API integration for accurate cost tracking" if total_tokens == 0 else "Token counts from session data; cost tracking requires Nous API",
    }


# ── Claude Code Endpoints ──────────────────────────────────────────────


@router.get("/claude-code/health")
async def get_claude_code_health():
    """Claude Code adapter health status."""
    if _claude_reader is None:
        return {"agent_id": "claude-code", "status": "disabled", "error_message": "Claude Code adapter not enabled"}
    return await _claude_reader.get_health_info()


@router.get("/claude-code/sessions")
async def get_claude_code_sessions():
    """List Claude Code sessions with metadata."""
    if _claude_reader is None:
        return []
    sessions = await _claude_reader.list_sessions()
    return [s.model_dump(mode="json") for s in sessions]


@router.get("/claude-code/sessions/{session_id}/history")
async def get_claude_code_session_history(session_id: str, limit: int = Query(50, le=200)):
    """History entries for a specific Claude Code session (redacted)."""
    if _claude_reader is None:
        return []
    return await _claude_reader.get_session_history(session_id, limit=limit)


@router.get("/claude-code/tasks")
async def get_claude_code_tasks():
    """All tasks across all Claude Code sessions."""
    if _claude_reader is None:
        return []
    tasks = await _claude_reader.list_tasks()
    return [t.model_dump(mode="json") for t in tasks]


@router.get("/claude-code/plans")
async def get_claude_code_plans():
    """List Claude Code execution plan files."""
    if _claude_reader is None:
        return []
    plans = await _claude_reader.list_plans()
    return [p.model_dump(mode="json") for p in plans]


@router.get("/claude-code/plans/{filename}")
async def get_claude_code_plan_content(filename: str):
    """Full plan content (redacted)."""
    if _claude_reader is None:
        raise HTTPException(status_code=404, detail="Claude Code adapter not enabled")
    content = await _claude_reader.get_plan_content(filename)
    if content is None:
        raise HTTPException(status_code=404, detail=f"Plan not found: {filename}")
    return {"filename": filename, "content": content}


@router.get("/claude-code/skills")
async def get_claude_code_skills():
    """Claude Code skill registry (allowlisted fields only)."""
    if _claude_reader is None:
        return []
    return await _claude_reader.list_skills()


@router.get("/claude-code/settings")
async def get_claude_code_settings():
    """Allowlisted settings summary. Never exposes raw permissions or hooks."""
    if _claude_reader is None:
        return {}
    return await _claude_reader.get_settings_summary()


@router.get("/claude-code/file-history/{session_id}")
async def get_claude_code_file_history(session_id: str):
    """File version history for a specific Claude Code session."""
    if _claude_reader is None:
        return []
    changes = await _claude_reader.get_file_history(session_id)
    return [c.model_dump(mode="json") for c in changes]
