# ACC Dashboard — Local Run Guide

Run the ARETE Command Center directly on your machine (no Docker required).

---

## Quick Start

```bash
# 1. Activate virtual environment (if not already active)
source .venv/bin/activate

# 2. Start the server
bash scripts/start.sh

# 3. Or start manually:
uvicorn server.main:app --host 127.0.0.1 --port 8643 --reload

# 4. Open dashboard
open http://localhost:8643
```

---

## Prerequisites

- Python 3.11+
- Hermes Agent running on port 8642 (for ARETE integration)
- Discord bot token in `~/.hermes/.env` (for Shu monitoring)

## Configuration

Edit `config.yaml`:

```yaml
acc:
  port: 8643
  host: "127.0.0.1"

hermes:
  url: "http://localhost:8642"   # Hermes API endpoint
  vault_path: "/mnt/c/Users/Iniolu/Documents/GitHub/Second brain"

discord:
  shu_channel_id: "1505240708079030302"
  home_channel_id: "1504537224690274356"
  env_token_var: "DISCORD_BOT_TOKEN"
```

## Architecture

The dashboard communicates with agents via HTTP APIs:
- **ARETE** → Hermes API on `localhost:8642`
- **Shu** → Discord REST API

It reads vault data directly from the filesystem.

---

**Note:** Docker files have been removed. This project runs natively via Python venv.
