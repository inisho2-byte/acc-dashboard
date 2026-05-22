#!/bin/bash
# Run ruff linter
set -e
cd "$(dirname "$0")/.."
.venv/Scripts/python -m ruff check server/ tests/ "$@"