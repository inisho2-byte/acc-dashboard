#!/bin/bash
# Run the full test suite
set -e
cd "$(dirname "$0")/.."
.venv/Scripts/python -m pytest tests/ -v "$@"