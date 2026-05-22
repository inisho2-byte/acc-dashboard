# Run the full test suite
Set-Location "$PSScriptRoot\.."
& ".\.venv\Scripts\python.exe" -m pytest tests/ -v @args