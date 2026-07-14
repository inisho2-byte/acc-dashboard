from __future__ import annotations

import asyncio
import os
import socket
import time
import logging
from pathlib import Path
from datetime import datetime, timezone
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import yaml
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from pythonjsonlogger import jsonlogger

from server.api import init_adapters, router as api_router
import server.api as api_module
from server.events import get_event_bus, publish_state_update

# ── Structured Logging ──────────────────────────────────────────────
logger = logging.getLogger("acc-dashboard")
logger.setLevel(logging.INFO)

handler = logging.StreamHandler()
formatter = jsonlogger.JsonFormatter(
    fmt="%(asctime)s %(name)s %(levelname)s %(message)s %(pathname)s %(lineno)d",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
handler.setFormatter(formatter)
logger.addHandler(handler)


class SensitiveFilter(logging.Filter):
    """Redact sensitive fields from log messages, including nested dicts."""

    SENSITIVE_PATTERNS = ["token", "password", "secret", "key", "authorization", "credential"]

    def filter(self, record: logging.LogRecord) -> bool:
        msg = str(record.msg) if record.msg else ""
        for pattern in self.SENSITIVE_PATTERNS:
            if pattern.lower() in msg.lower():
                record.msg = "***REDACTED***"
                break
        # Recursively redact nested dicts in extra fields
        if hasattr(record, "__dict__"):
            self._redact_dict(record.__dict__)
        return True

    def _redact_dict(self, d: dict) -> None:
        """Recursively redact sensitive keys in nested dicts."""
        for k, v in list(d.items()):
            if isinstance(v, str) and k.startswith("_"):
                continue
            if any(p in k.lower() for p in self.SENSITIVE_PATTERNS):
                if not k.startswith("_") and isinstance(v, (str, int, float)):
                    d[k] = "***REDACTED***"
            elif isinstance(v, dict):
                self._redact_dict(v)


logger.addFilter(SensitiveFilter())

# ── Configuration ─────────────────────────────────────────────────
CONFIG_PATH = Path(__file__).parent.parent / "config.yaml"


def load_config() -> dict:
    cfg_path = CONFIG_PATH
    if not cfg_path.is_file():
        return {
            "acc": {"port": 8643, "host": "127.0.0.1", "request_timeout": 30},
            "hermes": {"vault_path": str(Path.home() / ".hermes")},
            "discord": {
                "shu_channel_id": "",
                "env_token_var": "DISCORD_BOT_TOKEN",
            },
        }
    with open(cfg_path) as f:
        return yaml.safe_load(f) or {}


cfg = load_config()
hermes_cfg = cfg.get("hermes", {})
discord_cfg = cfg.get("discord", {})
acc_cfg = cfg.get("acc", {})

# Request timeout in seconds
REQUEST_TIMEOUT = acc_cfg.get("request_timeout", 30)

vault_path = hermes_cfg.get(
    "vault_path",
    "/mnt/c/Users/Iniolu/Documents/GitHub/Second brain",
)
hermes_url = hermes_cfg.get("url", "http://localhost:8642")

# ── CORS with LAN IP Auto-Detection ────────────────────────────────
BASE_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8643",
    "http://127.0.0.1:8643",
    "http://localhost:8080",
    "http://127.0.0.1:8080",
]


def _detect_lan_ips() -> list[str]:
    """Auto-detect private network IPs for CORS."""
    ips: list[str] = []
    try:
        hostname = socket.gethostname()
        addr_infos = socket.getaddrinfo(hostname, None)
        for info in addr_infos:
            ip = info[4][0] if len(info) > 3 and info[4] else None
            if ip and ip not in ips:
                # Private ranges: 10.x, 172.16-31.x, 192.168.x
                if ip.startswith(("10.", "172.", "192.168.")):
                    ips.append(ip)
    except Exception as exc:
        logger.debug(f"lan_ip_detection_failed", extra={"error": str(exc)})

    # Also add explicit LAN IPs from config
    for ip in acc_cfg.get("lan_ips", []):
        if ip not in ips:
            ips.append(ip)

    return ips


def _build_allowed_origins() -> list[str]:
    """Build full CORS origin list including LAN IPs."""
    origins = list(BASE_ORIGINS)
    for ip in _detect_lan_ips():
        for port in [5173, 8643, 8080]:
            origin = f"http://{ip}:{port}"
            if origin not in origins:
                origins.append(origin)
    return origins


ALLOWED_ORIGINS = _build_allowed_origins()

# ── API Token for Authentication ────────────────────────────────────
# If ACC_API_TOKEN is set, all /api/* routes (except SSE and health probes) require it.
# If not set, auth is skipped (development mode).
ACC_API_TOKEN = os.environ.get("ACC_API_TOKEN", "")

# ── App Initialization ──────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Manage app lifecycle with proper startup/shutdown handling."""
    # Startup
    port = acc_cfg.get("port", 8643)
    host = acc_cfg.get("host", "127.0.0.1")
    logger.info(
        "acc_dashboard_startup",
        extra={"host": host, "port": port},
    )
    logger.debug(
        "acc_dashboard_origins",
        extra={"allowed_origins_count": len(ALLOWED_ORIGINS)},
    )
    # Backfill skill usage from Hermes session logs
    try:
        from server.db import backfill_skill_usage_from_sessions
        backfilled = backfill_skill_usage_from_sessions()
        if backfilled:
            logger.info("skill_usage_backfill", extra={"skills_updated": backfilled})
    except Exception as exc:
        logger.warning("skill_usage_backfill_failed", extra={"error": str(exc)})

    # Start SSE background publisher
    sse_task = asyncio.create_task(publish_state_update())

    # Start search auto-reindex every 5 minutes
    async def auto_reindex_loop():
        await asyncio.sleep(30)
        while True:
            try:
                if api_module._search is not None:
                    counts = await api_module._search.rebuild()
                    logger.info("search_auto_reindex", extra={"indexed": counts})
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning("search_auto_reindex_failed", extra={"error": str(exc)})
            await asyncio.sleep(300)

    reindex_task = asyncio.create_task(auto_reindex_loop())

    # Start daily snapshot recording (midnight UTC)
    async def daily_snapshot_loop():
        """Record daily metrics at midnight UTC."""
        while True:
            now = datetime.now(timezone.utc)
            # Next midnight UTC
            next_midnight = (now + __import__("datetime").timedelta(days=1)).replace(
                hour=0, minute=0, second=0, microsecond=0
            )
            wait_seconds = (next_midnight - now).total_seconds()
            await asyncio.sleep(wait_seconds)
            try:
                from server.db import record_metric, get_connection

                # Record session count
                if api_module._hermes is not None:
                    try:
                        health = await api_module._hermes.health()
                        record_metric("total_sessions", health.session_count or 0)
                    except Exception:
                        pass

                # Record error count by type prefix
                if api_module._hermes is not None and api_module._shu is not None:
                    try:
                        arete_errs = await api_module._hermes.recent_errors(100)
                        shu_errs = await api_module._shu.recent_errors(100)
                        type_counts: dict[str, int] = {}
                        for e in arete_errs + shu_errs:
                            msg = e.message.lower() if e.message else ""
                            if "429" in msg or "rate" in msg:
                                prefix = "discord_429"
                            elif "timeout" in msg:
                                prefix = "cli_timeout"
                            elif "connection" in msg or "refused" in msg:
                                prefix = "connection_refused"
                            else:
                                prefix = "other"
                            type_counts[prefix] = type_counts.get(prefix, 0) + 1
                        record_metric("error_count", len(arete_errs) + len(shu_errs), type_counts)
                    except Exception:
                        pass

                # Record project count
                if api_module._vault is not None:
                    try:
                        projects = api_module._vault.get_all_projects()
                        record_metric("projects_total", len(projects))
                    except Exception:
                        pass

                # Record skill usage count
                try:
                    from server.db import get_all_skill_usage
                    usage = get_all_skill_usage()
                    used_today = sum(1 for u in usage if u.get("last_used", "")[:10] == now.strftime("%Y-%m-%d"))
                    record_metric("skills_used_today", used_today)
                except Exception:
                    pass

                # Record vault entity count
                if api_module._vault is not None:
                    try:
                        vitals = api_module._vault.get_entity_count()
                        record_metric("vault_entities", vitals)
                    except Exception:
                        pass

                logger.info("daily_snapshot_recorded")
            except Exception as exc:
                logger.warning("daily_snapshot_failed", extra={"error": str(exc)})

    snapshot_task = asyncio.create_task(daily_snapshot_loop())

    yield

    # Shutdown
    sse_task.cancel()
    reindex_task.cancel()
    snapshot_task.cancel()
    logger.info("acc_dashboard_shutdown")


app = FastAPI(
    title="ARETE Command Center",
    version="0.4.0",
    description="Unified dashboard for AI agents",
    lifespan=lifespan,
)

# ── Rate Limiting ──────────────────────────────────────────────
# A3: Rate limiting with per-endpoint limits.
# Default: 100/min. Override with @limiter.limit() on specific routes.
# SSE /api/events is exempt (can't rate-limit long-lived connections).
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization"],
    expose_headers=["X-Request-ID"],
)

# ── Security Headers Middleware ──────────────────────────────────────────────


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Add security headers + request duration logging to all responses."""
    start = time.time()
    response = await call_next(request)
    duration_ms = round((time.time() - start) * 1000, 2)

    # Security headers
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
        "font-src https://fonts.gstatic.com; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )

    # Request duration logging
    logger.info(
        "api_request",
        extra={
            "path": request.url.path,
            "method": request.method,
            "status": response.status_code,
            "duration_ms": duration_ms,
            "client_ip": request.client.host if request.client else "-",
        },
    )
    return response


# ── Auth Middleware ──────────────────────────────────────────────────
# Require Bearer token on all /api/* routes except SSE and health probes.
# If ACC_API_TOKEN is not set, auth is skipped (development mode).

AUTH_EXEMPT_PATHS = {"/healthz", "/readyz", "/api/events"}
RATE_LIMIT_EXEMPT_PATHS = {"/api/events"}  # SSE can't be rate-limited


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    """Require Bearer token for /api/* routes when ACC_API_TOKEN is set."""
    if not ACC_API_TOKEN:
        # Development mode — no auth enforced
        return await call_next(request)

    path = request.url.path

    # Exempt paths that don't need auth
    if path in AUTH_EXEMPT_PATHS:
        return await call_next(request)

    # SSE chat stream uses query-param auth (EventSource can't send headers)
    if path.startswith("/api/chat/stream"):
        return await call_next(request)

    # Static files (non-/api paths) are also exempt
    if not path.startswith("/api"):
        return await call_next(request)

    # Check Authorization header
    auth_header = request.headers.get("Authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
        if token == ACC_API_TOKEN:
            return await call_next(request)

    # Auth failed
    return JSONResponse(
        status_code=401,
        content={"detail": "Missing or invalid API token"},
    )


# ── Stricter Rate Limiting for Expensive Routes ──────────────────────────
# A3: Per-path rate limits beyond the default 100/min global limit.
# These are applied as middleware checks before the global limiter.

EXPENSIVE_ROUTE_LIMITS = {
    "/api/search": ("20/minute", "GET"),
    "/api/search/rebuild": ("2/minute", "POST"),
    "/api/dispatch": ("10/minute", "POST"),
    "/api/skills": ("20/minute", None), # Any method on skills
    "/api/chat/arete": ("10/minute", "POST"),
    "/api/chat/claude": ("10/minute", "POST"),
    "/api/chat/shu": ("20/minute", "POST"),
}


@app.middleware("http")
async def per_path_rate_limit(request: Request, call_next):
    """Apply stricter rate limits on expensive routes."""
    # This middleware runs per-request. Rate limit state is stored in app state.
    path = request.url.path.rstrip("/")
    limit_config = EXPENSIVE_ROUTE_LIMITS.get(path)
    if limit_config is None:
        # Check prefix match for skills/{name}/run
        if path.startswith("/api/skills/") and path.endswith("/run"):
            limit_config = ("10/minute", "POST")

    if limit_config:
        max_limit, method = limit_config
        if method and request.method != method:
            return await call_next(request)

        # Use slowapi's in-memory storage to check limits
        # (The global 100/min limiter is already configured in main.py)
        # We rely on the global limiter for basic enforcement.
        # This middleware blocks rapid sequential calls to expensive endpoints.
        import time
        key = f"per_path:{path}:{request.client.host}"
        now = time.time()
        if not hasattr(app.state, "per_path_limits"):
            app.state.per_path_limits = {}

        if key in app.state.per_path_limits:
            last_time = app.state.per_path_limits[key]
            # Simple throttle: minimum 1 second between calls to expensive routes
            if now - last_time < 1.0:
                return JSONResponse(
                    status_code=429,
                    content={"detail": f"Rate limit exceeded for {path}. Please slow down."},
                    headers={"Retry-After": "1"},
                )
        app.state.per_path_limits[key] = now

    return await call_next(request)


# ── Request Timeout Middleware ──────────────────────────────────────────────


# Routes that spawn agent tasks and need longer than the global request timeout.
LONG_RUNNING_PREFIXES = ("/api/dispatch", "/api/skills/", "/api/chat/")
LONG_RUNNING_TIMEOUT = 180  # 3 minutes — matches agent task processing time


@app.middleware("http")
async def timeout_handler(request: Request, call_next):
    """Add request timeout to prevent indefinite hangs.
    
    Dispatch and skill-run routes get a longer timeout (180s) because they
    wait for the Hermes agent to process the task end-to-end.
    All other routes use the default REQUEST_TIMEOUT (30s).
    """
    path = request.url.path.rstrip("/")
    timeout = LONG_RUNNING_TIMEOUT if any(path.startswith(p) for p in LONG_RUNNING_PREFIXES) else REQUEST_TIMEOUT
    try:
        return await asyncio.wait_for(
            call_next(request),
            timeout=timeout,
        )
    except asyncio.TimeoutError:
        logger.warning(
            f"Request timeout after {timeout}s",
            extra={"path": request.url.path, "method": request.method},
        )
        return JSONResponse(
            status_code=504,
            content={"detail": f"Request timeout after {timeout} seconds"},
        )


# ── Exception Logging Middleware ──────────────────────────────────────


@app.middleware("http")
async def exception_logging_middleware(request: Request, call_next):
    """Log unhandled exceptions with full traceback."""
    try:
        return await call_next(request)
    except Exception as exc:
        logger.exception(
            "unhandled_error",
            extra={"path": request.url.path, "method": request.method},
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error"},
        )


# Serve the web dashboard
# NOTE: Static mount MUST come after all API routes, otherwise it catches everything.
WEB_DIR = Path(__file__).parent.parent / "web" / "dist"


claude_cfg = cfg.get("claude_code", {})

# ── Startup ──────────────────────────────────────────────────────
init_adapters(hermes_url, discord_cfg, vault_path, claude_cfg=claude_cfg)

# ── Routes ────────────────────────────────────────────────────
app.include_router(api_router, prefix="/api")

# Import and register admin router
from server.api import admin_router  # noqa: E402
app.include_router(admin_router, prefix="/api")


# ── Health Check Endpoints ────────────────────────────────────────
# MUST be defined BEFORE the static file mount, which catches all remaining paths.


@app.get("/healthz")
async def healthz():
    """Kubernetes/load balancer health check endpoint."""
    return {"status": "ok", "timestamp": datetime.now(timezone.utc).isoformat()}


@app.get("/readyz")
async def readyz():
    """Kubernetes readiness probe endpoint."""
    if api_module._hermes is None:
        return JSONResponse(
            status_code=503,
            content={"status": "not_ready", "reason": "Hermes adapter not initialized"},
        )

    degraded = []
    if api_module._shu is None:
        degraded.append("shu_uninitialized")

    return {
        "status": "ready",
        "degraded": degraded if degraded else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Static File Mount (MUST be last — catches all remaining paths for SPA) ──
if WEB_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(WEB_DIR), html=True), name="web")