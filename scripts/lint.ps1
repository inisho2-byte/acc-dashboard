# Run ruff linter
Set-Location "$PSScriptRoot\.."
& ".\.venv\Scripts\python.exe" -m ruff check server/ tests/ @args