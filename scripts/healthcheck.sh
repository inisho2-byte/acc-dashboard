#!/usr/bin/env bash
# Quick health check — exit 0 if dashboard is responsive
set -euo pipefail

PORT=${ACC_PORT:-8643}
curl -sf "http://127.0.0.1:${PORT}/api/health" > /dev/null
