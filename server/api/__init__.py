from __future__ import annotations

import asyncio
import json
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
from server.agents.sub_agent_adapter import SubAgentAdapter
from server.aggregators.activity_engine import ActivityEngine
from server.aggregators.briefing import BriefingGenerator
from server.aggregators.claude_code_reader import ClaudeCodeReader
from server.aggregators.context_engine import ContextEngine
from server.aggregators.cron_dashboard import CronDashboard
from server.aggregators.dispatch import dispatch_to_arete, dispatch_to_shu
from server.aggregators.health_score import HealthScoreEngine
from server.aggregators.ibcb_reader import IBCBReader # aliased TailscaleMailboxReader
from server.aggregators.memory_reader import MemoryReader
from server.aggregators.pipeline_engine import PipelineEngine
from server.aggregators.search_engine import SearchEngine
from server.aggregators.vault_analytics import VaultAnalytics
from server.aggregators.overview_engine import get_vps_health, get_activity_by_day, get_agent_response_counts, get_recent_activity, get_session_totals, get_gateway_info, AGENT_LOGS_DB
from server.aggregators.board import list_tasks, get_task, create_task, move_task, update_task, delete_task
from server.aggregators.cron_reader import get_system_crons, parse_hermes_crons
from server.events import get_event_bus
from server.models import DashboardHealth, AgentStatus
from server.models import ClaudeSession, ClaudeTask, ClaudePlan, ClaudeFileChange
from server.vault import VaultReader
from server.utils.circuit_breaker import CircuitBreaker, CircuitState, CircuitOpenError
from server.chat.models import ChatRequest, ChatResponse, ChatEvent
from server.chat.session_store import ChatSessionStore
from server.chat.arete_chat import AreteChatEngine
from server.chat.claude_chat import ClaudeChatEngine
from server.chat.shu_chat import ShuChatEngine

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

# ── Sub-agents (Scout, Scribe, Reach, Dev) ────────────────────────────
_sub_agents: dict[str, SubAgentAdapter] = {}
SUB_AGENT_IDS = ("scout", "scribe", "reach", "dev")

# ── Chat engine globals ──────────────────────────────────────────────
_chat_store: ChatSessionStore | None = None
_arete_chat: AreteChatEngine | None = None
_claude_chat: ClaudeChatEngine | None = None
_shu_chat: ShuChatEngine | None = None

_start_time = datetime.now(timezone.utc)


def init_adapters(hermes_url: str, discord_cfg: dict, vault_path: str, claude_cfg: dict | None = None) -> None:
    global _hermes, _shu, _vault, _activity, _briefing, _search, _ibcb, _discord_cfg
    global _context, _memory, _pipeline, _health_score, _vault_analytics, _cron_dashboard
    global _claude, _claude_reader
    global _chat_store, _arete_chat, _claude_chat, _shu_chat
    global _sub_agents
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

    # ── Chat engines ──────────────────────────────────────────────
    _chat_store = ChatSessionStore()
    bus = get_event_bus()
    _arete_chat = AreteChatEngine(_chat_store)
    _claude_chat = ClaudeChatEngine(_chat_store, bus)
    # ShuChatEngine needs an httpx.AsyncClient — create a shared one
    import httpx
    _shu_http = httpx.AsyncClient()
    _shu_chat = ShuChatEngine(_chat_store, _shu_http)
    logger.info("chat_engines_initialized")

    # ── Sub-agents (Scout, Scribe, Reach, Dev) ──────────────────────
    for agent_id in SUB_AGENT_IDS:
        try:
            adapter = SubAgentAdapter(agent_id)
            _sub_agents[agent_id] = adapter
            logger.info(
                "sub_agent_initialized",
                extra={"agent_id": agent_id, "port": adapter._port},
            )
        except Exception as exc:
            logger.warning(
                "sub_agent_init_failed",
                extra={"agent_id": agent_id, "error": str(exc)},
            )


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

    # Sub-agents health checks (parallel for speed)
    sub_agent_results: dict[str, AgentStatus] = {}
    async def _check_sub(agent_id: str, adapter: SubAgentAdapter) -> tuple[str, AgentStatus]:
        try:
            return agent_id, await adapter.health()
        except Exception as exc:
            return agent_id, AgentStatus(
                agent_id=agent_id,
                agent_type="hermes-sub",
                name=f"ARETE {adapter._display_name}",
                status="offline",
                model=adapter._model,
                error_message=str(exc),
            )

    if _sub_agents:
        results = await asyncio.gather(
            *[_check_sub(aid, adapter) for aid, adapter in _sub_agents.items()]
        )
        sub_agent_results = dict(results)

    all_agents = {
        "arete": arete,
        "shu": shu,
        **({"claude-code": claude} if claude else {}),
        **sub_agent_results,
    }

    return DashboardHealth(
        agents=all_agents,
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
    if agent_id in _sub_agents:
        return await _sub_agents[agent_id].health()
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
    sessions = []
    if _hermes is not None:
        try:
            sessions.extend(await _hermes.recent_sessions(limit))
        except Exception:
            pass
    if _shu is not None:
        try:
            sessions.extend(await _shu.recent_sessions(limit))
        except Exception:
            pass
    # Merge and sort by last_active desc
    sessions.sort(key=lambda s: s.last_active, reverse=True)
    return sessions[:limit]


@router.get("/sessions/{agent_id}")
async def get_agent_sessions(agent_id: str, limit: int = 10):
    if agent_id == "arete" and _hermes is not None:
        try:
            return await _hermes.recent_sessions(limit)
        except Exception:
            return []
    if agent_id == "shu" and _shu is not None:
        try:
            return await _shu.recent_sessions(limit)
        except Exception:
            return []
    return []


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
    if _activity is None:
        return []
    try:
        return await _activity.get_timeline(
            limit=limit,
            agent_id=agent_id,
            event_type=event_type,
        )
    except Exception:
        return []


@router.get("/activity/{agent_id}")
async def get_agent_activity(
    agent_id: str,
    limit: int = Query(50, le=200),
    event_type: str | None = Query(None),
):
    if _activity is None:
        return []
    try:
        return await _activity.get_timeline(
            limit=limit,
            agent_id=agent_id,
            event_type=event_type,
        )
    except Exception:
        return []


@router.get("/briefing")
async def get_briefing(
    hours: int = Query(24, le=168),
    since: str | None = Query(None, description="ISO timestamp for 'since last checkin'"),
):
    if _briefing is None:
        return {"error": "Briefing engine not initialized", "items": []}
    try:
        if since:
            try:
                since_dt = datetime.fromisoformat(since)
            except (ValueError, TypeError):
                return {"error": "Invalid since parameter. Use ISO timestamp format.", "items": []}
            return await _briefing.generate(since=since_dt)
        return await _briefing.generate(hours=hours)
    except Exception as e:
        return {"error": f"Briefing generation failed: {e}", "items": []}


@router.get("/context-gaps")
async def get_context_gaps(limit: int = Query(50, le=200)):
    """Surface knowledge gaps between ARETE and Shu agents."""
    if _context is None:
        return []
    try:
        return await _context.get_gaps(limit=limit)
    except Exception:
        return []


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

    # Sub-agents (Scout, Scribe, Reach, Dev)
    for _aid, _adapter in _sub_agents.items():
        try:
            _h = await _adapter.health()
            data["agents"].append(
                {
                    "id": _aid,
                    "name": _h.name,
                    "status": _h.status,
                    "model": _h.model,
                    "session_count": _h.session_count,
                    "current_task": _h.current_task,
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


# ── Overview & VPS Endpoints ──────────────────────────────────────────


@router.get("/overview")
async def get_overview():
    """Aggregate overview data for the Overview tab: agents, VPS, activity, stats."""
    import asyncio

    # Gather agent health (reuse health logic with sub-agents)
    agents = {}
    for agent_id, adapter in [
        ("arete", _hermes),
        ("shu", _shu),
    ] + [("claude-code", _claude)] + [(aid, _sub_agents[aid]) for aid in _sub_agents]:
        if adapter is None:
            continue
        try:
            h = await adapter.health()
            agents[agent_id] = {
                "id": agent_id,
                "name": h.name,
                "status": h.status,
                "model": h.model,
                "session_count": h.session_count,
                "current_task": h.current_task,
                "error_count": h.error_count,
                "last_active": h.last_active.isoformat() if h.last_active else None,
            }
        except Exception as exc:
            agents[agent_id] = {"id": agent_id, "name": agent_id.upper(), "status": "offline", "error_message": str(exc)}

    # Response counts per agent
    response_counts = get_agent_response_counts()

    # Activity by day (last 7 days)
    activity_by_day = get_activity_by_day(7)

    # Recent activity
    activity = get_recent_activity(20)

    # Session totals
    session_totals = get_session_totals()

    # Gateway info
    gateway = await get_gateway_info()

    # Health score
    try:
        health_data = await get_health_score()
        score = health_data.get("score", 0)
    except Exception:
        score = 0

    # Stats
    total_agents = len(agents)
    online_agents = sum(1 for a in agents.values() if a.get("status") == "online")
    total_responses = sum(response_counts.values())
    failed = sum(a.get("error_count", 0) for a in agents.values())
    completed = total_responses
    success_rate = round(completed / max(completed + failed, 1) * 100, 2)

    # Cache tokens from inference usage
    cache_hits = 0
    try:
        arete_sessions = await _hermes.recent_sessions(50)
        for s in arete_sessions:
            cache_hits += getattr(s, "token_count", 0) or 0
    except Exception:
        pass

    # Kanban (cron jobs count)
    kanban_total = 0
    try:
        from server.db import get_connection
        with get_connection() as conn:
            # Try to get cron tasks count from the cron dashboard
            pass  # Will use CronDashboard instead
    except Exception:
        pass
    try:
        cron_data = await _cron_dashboard.get_summary()
        kanban_total = cron_data.get("total_jobs", 0)
    except Exception:
        pass

    # Calculate uptime from ARETE agent
    uptime_seconds = None
    arete_status = agents.get("arete", {})
    if arete_status:
        uptime_seconds = None  # Will be derived from process start

    return {
        "agents": agents,
        "vps": await get_vps_health(),
        "activity_by_day": activity_by_day,
        "activity": activity,
        "stats": {
            "total": total_responses + completed,  # total responses + completed
            "completed": completed,
            "failed": failed,
            "success_rate": success_rate,
        },
        "sessions": {
            "count": session_totals.get("count", 0),
            "totals": {
                "messages": total_responses,
                "input_tokens": 0,
                "cache_read_tokens": cache_hits,
            },
        },
        "kanban": {"total": kanban_total},
        "gateway": {
            "uptime_seconds": uptime_seconds,
            "status": gateway.get("status", "unknown"),
        },
        "score": score,
        "online_agents": online_agents,
        "total_agents": total_agents,
        "response_counts": response_counts,
    }


@router.get("/vps")
async def get_vps():
    """Real-time VPS metrics: CPU, RAM, Disk, DB sizes."""
    return await get_vps_health()


@router.get("/agents")
async def get_agents():
    """Agent details for the Agents tab: cards, status, 7-day activity, logs."""
    from datetime import datetime, timezone, timedelta
    import sqlite3

    # ── Agent metadata ──────────────────────────────────────────────────
    AGENT_META = {
        "arete":   {"code": "ORCH", "name": "Orchestrator", "role": "Central command agent — dispatches tasks, orchestrates sub-agent pipelines, and manages the ACC Dashboard.", "platform": "Discord", "accent": "#A78BFA"},
        "scout":   {"code": "SCNT", "name": "Scout",        "role": "Research & reconnaissance agent — deep web research, synthesis, and intelligence briefings.", "platform": "Discord", "accent": "#7DD3FC"},
        "scribe":  {"code": "SCRB", "name": "Scribe",        "role": "Writing & documentation agent — blog posts, documentation, and editorial content from research.", "platform": "Discord", "accent": "#F472B6"},
        "reach":   {"code": "RECH", "name": "Reach",         "role": "Marketing & distribution agent — social media captions, strategy, and audience targeting.", "platform": "Discord", "accent": "#E879F9"},
        "dev":     {"code": "DEV",  "name": "Dev",            "role": "Engineering & build agent — code implementation, debugging, and deployment.", "platform": "Telegram", "accent": "#A78BFA"},
    }

    # ── Classify status by last_active timestamp ─────────────────────────
    now = datetime.now(timezone.utc)
    threshold_active = now - timedelta(minutes=10)
    threshold_idle = now - timedelta(hours=6)

    # ── Gather health from adapters ──────────────────────────────────────
    agents = {}
    for agent_id, meta in AGENT_META.items():
        adapter = None
        if agent_id == "arete" and _hermes:
            adapter = _hermes
        elif agent_id in _sub_agents:
            adapter = _sub_agents.get(agent_id)
        elif agent_id == "shu" and _shu:
            # Shu not shown in agents tab per spec (5 agents only)
            pass

        if adapter is None:
            agents[agent_id] = {**meta, "status_class": "dormant", "health_status": "offline", "model": "", "session_count": 0, "error_count": 0, "last_active": None, "current_task": None, "responses": 0, "success_rate": 0, "activity_7d": [], "last_task": None, "last_task_time": None}
            continue

        try:
            h = await adapter.health()
            last_active = h.last_active
            last_active_str = last_active.isoformat() if last_active else None

            if last_active and last_active > threshold_active:
                status_class = "active"
            elif last_active and last_active > threshold_idle:
                status_class = "idle"
            else:
                status_class = "dormant"

            agents[agent_id] = {
                **meta,
                "health_status": h.status,
                "status_class": status_class,
                "model": h.model or "",
                "session_count": h.session_count,
                "error_count": h.error_count,
                "last_active": last_active_str,
                "current_task": h.current_task,
            }
        except Exception as exc:
            agents[agent_id] = {**meta, "status_class": "dormant", "health_status": "error", "model": "", "session_count": 0, "error_count": 0, "last_active": None, "current_task": None, "error_message": str(exc)[:120]}

    # ── Per-agent response counts & success rates from agent-logs.db ─────
    response_counts = get_agent_response_counts()
    for aid in agents:
        agents[aid]["responses"] = response_counts.get(aid, 0)

    # ── Per-agent 7-day activity bars ────────────────────────────────────
    now_date = datetime.now(timezone.utc).date()
    for aid in agents:
        daily = []
        for i in range(6, -1, -1):
            day = now_date - timedelta(days=i)
            daily.append({"date": day.isoformat(), "count": 0})
        agents[aid]["activity_7d"] = daily

    if AGENT_LOGS_DB.is_file():
        try:
            conn = sqlite3.connect(str(AGENT_LOGS_DB))
            cur = conn.cursor()
            week_ago = (now_date - timedelta(days=7)).isoformat()
            cur.execute(
                "SELECT agent_name, DATE(created_at), COUNT(*) FROM agent_logs WHERE created_at > ? GROUP BY agent_name, DATE(created_at)",
                (week_ago + "T00:00:00Z",),
            )
            for row in cur.fetchall():
                aid, day_str, count = row
                if aid in agents:
                    for d in agents[aid]["activity_7d"]:
                        if d["date"] == day_str:
                            d["count"] = count
            # Also fill success rate
            cur.execute(
                "SELECT agent_name, status, COUNT(*) FROM agent_logs GROUP BY agent_name, status",
            )
            for row in cur.fetchall():
                aid, status, count = row
                if aid in agents:
                    if status == "completed":
                        pass  # already in response_counts
                    if status == "failed":
                        agents[aid].setdefault("_failed", 0)
                        agents[aid]["_failed"] = agents[aid].get("_failed", 0) + count
            conn.close()
        except Exception:
            pass

    # Calculate success rates
    for aid in agents:
        completed = response_counts.get(aid, 0)
        failed = agents[aid].pop("_failed", 0)
        total = completed + failed
        agents[aid]["success_rate"] = round(completed / max(total, 1) * 100, 1) if total > 0 else 100.0

    # ── Last task per agent ───────────────────────────────────────────────
    last_tasks = get_recent_activity(50)
    for entry in reversed(last_tasks):
        aid = entry.get("agent", "")
        if aid in agents and agents[aid].get("last_task") is None:
            agents[aid]["last_task"] = entry.get("task", "")[:100]
            agents[aid]["last_task_time"] = entry.get("timestamp")

    # Default missing tasks
    for aid in agents:
        agents[aid].setdefault("last_task", None)
        agents[aid].setdefault("last_task_time", None)

    # ── Full activity log for the table ──────────────────────────────────
    activity_log = get_recent_activity(100)

    # ── Status counts ────────────────────────────────────────────────────
    active = sum(1 for a in agents.values() if a["status_class"] == "active")
    idle = sum(1 for a in agents.values() if a["status_class"] == "idle")
    dormant = sum(1 for a in agents.values() if a["status_class"] == "dormant")

    return {
        "agents": agents,
        "log": activity_log,
        "status_summary": {"active": active, "idle": idle, "dormant": dormant},
        "activity_by_day": get_activity_by_day(7),
        "stats": {
            "total": sum(response_counts.values()),
            "completed": sum(response_counts.values()),
            "failed": sum(a.get("error_count", 0) for a in agents.values() if isinstance(a, dict)),
            "success_rate": round(sum(response_counts.values()) / max(sum(response_counts.values()) + sum(a.get("error_count", 0) for a in agents.values() if isinstance(a, dict)), 1) * 100, 1),
        },
    }


# ── Task Board Endpoints ───────────────────────────────────────────────


@router.get("/board")
async def api_list_tasks():
    """List all tasks on the board, ordered by status then created_at."""
    return list_tasks()


@router.post("/board")
async def api_create_task(request: Request):
    """Create a new task. Body: {title, priority?, notes?}"""
    body = await request.json()
    title = body.get("title", "").strip()
    if not title:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "title is required"}, status_code=400)
    priority = body.get("priority", "medium")
    notes = body.get("notes")
    task = create_task(title=title, priority=priority, notes=notes)
    return task


@router.put("/board/{task_id}")
async def api_update_task(task_id: str, request: Request):
    """Update a task's title, priority, or notes."""
    body = await request.json()
    task = update_task(task_id, **{k: body[k] for k in ("title", "priority", "notes") if k in body})
    if task is None:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "task not found"}, status_code=404)
    return task


@router.post("/board/{task_id}/move")
async def api_move_task(task_id: str, request: Request):
    """Move task forward (direction=1) or backward (direction=-1). Body: {direction: 1|-1}"""
    body = await request.json()
    direction = body.get("direction", 1)
    task = move_task(task_id, direction=direction)
    if task is None:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "task not found"}, status_code=404)
    return task


@router.delete("/board/{task_id}")
async def api_delete_task(task_id: str):
    """Delete a task."""
    deleted = delete_task(task_id)
    if not deleted:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "task not found"}, status_code=404)
    return {"deleted": True, "id": task_id}


# ── Content Library Endpoints ────────────────────────────────────────────

from server.aggregators.content import list_content, get_content, save_content


@router.get("/content")
async def api_content_list():
    """List all .md files in the content library."""
    return list_content()


@router.get("/content/get")
async def api_content_get(path: str = ""):
    """Get a single file's raw markdown content. Path must be under content root."""
    if not path:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "path parameter is required"}, status_code=400)
    result = get_content(path)
    if result is None:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "file not found or invalid path"}, status_code=404)
    return result


@router.post("/content/save")
async def api_content_save(request: Request):
    """Save content to a file. Body: {path, content}."""
    body = await request.json()
    path = body.get("path", "").strip()
    content = body.get("content", "")
    if not path:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "path is required"}, status_code=400)
    result = save_content(path, content)
    if result is None:
        from fastapi.responses import JSONResponse
        return JSONResponse({"error": "invalid path or write failed"}, status_code=400)
    return result


# ── Schedule Endpoints ─────────────────────────────────────────────────


@router.get("/schedule")
async def api_schedule():
    """Return combined Hermes + system cron jobs for the Schedule tab."""
    from server.aggregators.cron_reader import get_system_crons, parse_hermes_crons

    assert _hermes is not None
    assert _cron_dashboard is not None

    # Get Hermes cron jobs via Hermes adapter + CronDashboard
    try:
        jobs = await _hermes.list_cron_jobs()
    except Exception:
        jobs = []
    cron_data = _cron_dashboard.get_dashboard(jobs)
    hermes_entries = parse_hermes_crons(cron_data)

    # System crons
    system_entries = get_system_crons()

    return {
        "hermes": hermes_entries,
        "system": system_entries,
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


# ── Chat API Routes ────────────────────────────────────────────────────
# Task 2.1: 6 chat endpoints + SSE stream (2.2)
# Rate limiting applied via EXPENSIVE_ROUTE_LIMITS in main.py.
# Auth enforced by the auth middleware on all /api/* routes.
# SSE endpoint uses query-param auth (EventSource can't send headers).


@router.post("/chat/arete")
async def chat_arete(req: ChatRequest) -> ChatResponse:
    """Send a message to ARETE via the Hermes CLI subprocess.

    Only one request at a time (409 on concurrent). 180s timeout.
    Returns a ChatResponse with messages array for the frontend.
    """
    if _arete_chat is None:
        raise HTTPException(status_code=503, detail="ARETE chat engine not initialized")
    resp = await _arete_chat.send(
        message=req.message,
        session_id=req.session_id,
        model=req.model,
    )
    # Populate messages array so the frontend can render assistant reply
    if resp.success and resp.response:
        from server.chat.models import ChatMessage
        now = datetime.now(timezone.utc).isoformat()
        resp.messages = [
            ChatMessage(role="user", content=req.message, timestamp=now),
            ChatMessage(role="assistant", content=resp.response, timestamp=now),
        ]
        if req.model:
            resp.model = req.model
    return resp


@router.post("/chat/claude")
async def chat_claude(req: ChatRequest):
    """Send a message to Claude Code and stream events via SSE.

    Returns immediately with a request_id. The client opens an SSE
    connection to /chat/stream/{request_id} to receive streaming events.
    Only one request at a time (409 on concurrent).
    """
    if _claude_chat is None:
        raise HTTPException(status_code=503, detail="Claude chat engine not initialized")
    if not req.model:
        raise HTTPException(status_code=422, detail="model is required for Claude chat")
    request_id = _req_id()
    # Fire-and-forget: the subprocess runs in the background while
    # the client subscribes to events via SSE.
    asyncio.create_task(
        _claude_chat.send(
            message=req.message,
            session_id=req.session_id,
            model=req.model,
            request_id=request_id,
        )
    )
    return {"success": True, "request_id": request_id}


@router.post("/chat/shu")
async def chat_shu(req: ChatRequest):
    """Send a chat message to Shu over HTTP (Tailscale).

    The message is POSTed to Shu's endpoint and logged to the
    shared JSONL inbox. Response polling is via GET /chat/shu/messages.
    """
    if _shu_chat is None:
        raise HTTPException(status_code=503, detail="Shu chat engine not initialized")
    result = await _shu_chat.send(req.message)
    if not result.get("success"):
        raise HTTPException(status_code=502, detail=result.get("error", "Shu unreachable"))
    return result


@router.get("/chat/shu/messages")
async def chat_shu_messages(
    since: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
):
    """Read chat messages from Shu's JSONL inbox.

    Returns messages where from=="shu" (not "shu-trading") and
    type is "chat" or "chat_out". Ordered by timestamp ascending.
    """
    messages = ShuChatEngine.get_messages(since=since, limit=limit)
    return {"messages": messages, "has_more": len(messages) >= limit}


@router.get("/chat/arete/models")
async def chat_arete_models():
    """List available models for ARETE chat.

    Reads from the Hermes config or falls back to a default list.
    """
    # Try reading hermes model list from config
    try:
        import subprocess
        result = subprocess.run(
            ["hermes", "model", "list"],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode == 0:
            models = [line.strip() for line in result.stdout.strip().splitlines() if line.strip()]
            current = ""
            return {"models": models, "current": current}
    except Exception:
        pass
    # Fallback defaults
    return {"models": [], "current": ""}


@router.get("/chat/claude/models")
async def chat_claude_models():
    """List available models for Claude Code chat.

    Reads from ~/ollama_cloud_models_cache.json, falls back to
    a hardcoded default list.
    """
    cache_path = Path.home() / "ollama_cloud_models_cache.json"
    models: list[str] = []
    current = ""
    try:
        if cache_path.exists():
            import json
            data = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                models = data.get("models", [])
                current = data.get("current", "")
            elif isinstance(data, list):
                models = data
    except Exception:
        pass
    if not models:
        models = ["sonnet", "haiku", "opus", "kimi-k2.6:cloud"]
        current = "sonnet"
    return {"models": models, "current": current}


@router.delete("/chat/{agent}/cancel")
async def chat_cancel(agent: str):
    """Cancel a running chat subprocess for the given agent.

    Sends SIGTERM (then SIGKILL after 0.5s) to the running process.
    Publishes a ChatEvent(type="cancelled") to SSE.
    """
    engine_map = {
        "arete": _arete_chat,
        "claude": _claude_chat,
    }
    engine = engine_map.get(agent)
    if engine is None:
        raise HTTPException(status_code=404, detail=f"No cancellable engine for agent: {agent}")

    cancelled = await engine.cancel()
    if not cancelled:
        return {"success": True, "cancelled": False, "detail": "No process was running"}

    # Publish cancelled event to SSE
    bus = get_event_bus()
    await bus.publish("chat", {
        "type": "cancelled",
        "channel": agent,
        "request_id": "",
        "content": "",
    })
    return {"success": True, "cancelled": True}


# ── SSE Stream Endpoint for Chat ─────────────────────────────────────
# Task 2.2: Query-param auth for SSE (EventSource can't send headers).
# Client opens: new EventSource("/api/chat/stream/{request_id}?token=X")

@router.get("/chat/stream/{request_id}")
async def chat_stream(
    request_id: str,
    token: str = Query(..., description="ACC_API_TOKEN for SSE auth"),
):
    """SSE endpoint that streams ChatEvents for a specific request.

    The client must provide a valid ACC_API_TOKEN as a query parameter.
    Events are sourced from the EventBus chat topic, filtered by
    request_id. The stream auto-closes on done/error/cancelled events
    or after a 45s idle timeout (sends heartbeat).
    """
    # Validate query-param token against ACC_API_TOKEN
    _api_token = os.environ.get("ACC_API_TOKEN", "")
    if _api_token and token != _api_token:
        raise HTTPException(status_code=401, detail="Invalid token")

    bus = get_event_bus()

    async def event_generator():
        queue: asyncio.Queue = asyncio.Queue(maxsize=128)
        bus.subscribe_topic(f"chat:{request_id}", queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=45)
                    data = event if isinstance(event, str) else json.dumps(event, default=str)
                    yield "data: " + data + "\n\n"
                    # Terminal events close the stream
                    if isinstance(event, dict) and event.get("type") in ("done", "error", "cancelled"):
                        break
                except asyncio.TimeoutError:
                    # Heartbeat to keep the connection alive
                    yield 'data: {"type": "heartbeat"}\n\n'
        finally:
            bus.unsubscribe_topic(f"chat:{request_id}", queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


def _req_id() -> str:
    """Generate a short unique request ID for SSE routing."""
    import uuid as _uuid
    return _uuid.uuid4().hex[:12]
