# ACC Dashboard

**ARETE Command Center** — a unified dashboard for watching AI agents.

It is an **observer, not a controller**. It reads agent state; it does not run
agents, manage connections, or replace anyone's process manager. That
distinction is the whole design: an offline agent is a data point, not a broken
dashboard.

FastAPI backend, Vite/React frontend, SQLite for local state.

---

## Running it

```bash
# backend (Python 3.11+)
pip install -e ".[dev]"
./scripts/start.sh

# frontend
cd web && npm install && npm run dev
```

```bash
./scripts/test.sh          # pytest        (test.ps1 on PowerShell)
./scripts/lint.sh          # ruff          (lint.ps1 on PowerShell)
./scripts/healthcheck.sh   # is it up?
```

---

## Layout

```
server/
  agents/       one adapter per agent type — implement AgentAdapter to add one
  aggregators/  roll per-agent state into dashboard views
  api/          FastAPI routes
  chat/         chat surface
  db/           SQLite access
  models/       pydantic models
  vault/        Obsidian vault reader
  events.py     event bus (SSE)
  main.py       app entrypoint
web/            Vite + React client
scripts/        start / test / lint / healthcheck, in both sh and ps1
config.yaml     which agents to watch, and how
docs/           integration plans, audits
08-notes/       implementation notes per work phase
AGENTS.md       the contract for AI agents working on this repo — read it first
```

### Adding an agent

Implement `AgentAdapter` in `server/agents/`:

```python
class AgentAdapter(ABC):
    def agent_id(self) -> str: ...
    def agent_type(self) -> str: ...
    def display_name(self) -> str: ...
    async def health(self) -> AgentStatus: ...
    async def recent_sessions(self, limit: int = 10) -> list[AgentSession]: ...
    async def recent_errors(self, limit: int = 10) -> list[AgentError]: ...
```

Every method must degrade gracefully. An agent that is down returns a status
saying so — it never raises into the dashboard.

---

## Configuration

- **`config.yaml`** — which agents to watch. Committed.
- **`.env`** — secrets and per-machine paths. **Gitignored, never committed.**
  Copy `.env.example` and fill it in; that file lists every key by name with no
  values.

---

## Security

- Secrets live only in `.env`. Full-history secret scan: clean as of 2026-07-25.
- Rate limiting via `slowapi`; structured JSON logging via `python-json-logger`.
- This repository is **private**.

---

## Notes

`uv.lock` is currently gitignored. For a deployed service you generally want the
lock file committed so installs are reproducible — worth revisiting.

Working notes for each build phase live in `08-notes/`; `docs/` holds the
integration plans and the dashboard audit.
