"""System and Hermes cron job discovery for the Schedule tab.

Reads crontab entries from:
  - Hermes cron jobs (from /api/cron/dashboard via the existing endpoint)
  - System crontabs (/etc/crontab, /etc/cron.d/*, user crontab)
  
Each entry is normalized to: source, schedule, command, owner, description.
"""

from __future__ import annotations

import os
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


CRONTAB_FIELDS_RE = re.compile(
    r"^"
    r"(?P<min>\S+)\s+"
    r"(?P<hour>\S+)\s+"
    r"(?P<dom>\S+)\s+"
    r"(?P<mon>\S+)\s+"
    r"(?P<dow>\S+)\s+"
    r"(?:(?P<user>\S+)\s+)?"  # optional user field (system crontab)
    r"(?P<command>.+)"
    r"$"
)

DOW_NAMES = {"0": "Sunday", "1": "Monday", "2": "Tuesday", "3": "Wednesday",
              "4": "Thursday", "5": "Friday", "6": "Saturday", "7": "Sunday"}
MON_NAMES = {"1": "January", "2": "February", "3": "March", "4": "April",
             "5": "May", "6": "June", "7": "July", "8": "August",
             "9": "September", "10": "October", "11": "November", "12": "December"}


def _describe_schedule(min_f: str, hour_f: str, dom_f: str, mon_f: str, dow_f: str) -> str:
    """Convert cron fields to a plain-English description."""
    parts = []

    # Frequency
    if min_f == "*" and hour_f == "*":
        parts.append("Every minute")
    elif min_f.startswith("*/") and hour_f == "*":
        parts.append(f"Every {min_f[2:]} minutes")
    elif hour_f.startswith("*/") and min_f == "0":
        parts.append(f"Every {hour_f[2:]} hours")
    elif min_f == "*" and hour_f != "*":
        parts.append(f"Every minute of hour {hour_f}")
    else:
        # Specific time
        time_str = f"{hour_f.zfill(2)}:{min_f.zfill(2)}"

        if dom_f != "*" or mon_f != "*" or dow_f != "*":
            when_parts = []
            if dow_f != "*":
                dow_names = []
                for d in dow_f.replace(",", " ").split():
                    dow_names.append(DOW_NAMES.get(d, f"day {d}"))
                when_parts.append("/".join(dow_names) if len(dow_names) > 1 else dow_names[0])
            if dom_f != "*":
                when_parts.append(f"day {dom_f}")
            if mon_f != "*":
                mon_names = []
                for m in mon_f.replace(",", " ").split():
                    mon_names.append(MON_NAMES.get(m, f"month {m}"))
                when_parts.append("/".join(mon_names) if len(mon_names) > 1 else mon_names[0])
            parts.append(f"At {time_str} on {' '.join(when_parts)}")
        else:
            parts.append(f"Daily at {time_str}")

    if not parts:
        parts.append(f"{min_f} {hour_f} {dom_f} {mon_f} {dow_f}")

    return parts[0]


def _parse_crontab_content(content: str, source: str, owner: str) -> list[dict[str, Any]]:
    """Parse crontab content into normalized entries."""
    entries = []
    for line in content.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("SHELL=") or line.startswith("PATH=") or line.startswith("MAILTO=") or line.startswith("HOME="):
            continue
        m = CRONTAB_FIELDS_RE.match(line)
        if not m:
            continue
        min_f = m.group("min")
        hour_f = m.group("hour")
        dom_f = m.group("dom")
        mon_f = m.group("mon")
        dow_f = m.group("dow")
        command = m.group("command").strip()

        # Skip anacron/run-parts noise
        if "run-parts" in command and "anacron" in command:
            continue

        schedule_raw = f"{min_f} {hour_f} {dom_f} {mon_f} {dow_f}"
        description = _describe_schedule(min_f, hour_f, dom_f, mon_f, dow_f)

        entries.append({
            "source": source,
            "schedule": schedule_raw,
            "command": command,
            "owner": owner,
            "description": description,
        })
    return entries


def get_system_crons() -> list[dict[str, Any]]:
    """Read system crontab files and return normalized entries."""
    entries = []

    # /etc/crontab
    crontab_path = "/etc/crontab"
    if os.path.exists(crontab_path):
        try:
            with open(crontab_path) as f:
                entries.extend(_parse_crontab_content(f.read(), crontab_path, "system"))
        except PermissionError:
            pass

    # /etc/cron.d/*
    cron_d = Path("/etc/cron.d")
    if cron_d.is_dir():
        for p in sorted(cron_d.iterdir()):
            if p.is_file() and not p.name.startswith("."):
                try:
                    entries.extend(_parse_crontab_content(p.read_text(), str(p), "system"))
                except (PermissionError, OSError):
                    pass

    # User crontab
    try:
        result = subprocess.run(["crontab", "-l"], capture_output=True, text=True, timeout=5)
        if result.returncode == 0:
            entries.extend(_parse_crontab_content(result.stdout, "user crontab", "hermes"))
    except (subprocess.TimeoutExpired, FileNotFoundError):
        pass

    return entries


def parse_hermes_crons(cron_data: dict) -> list[dict[str, Any]]:
    """Convert Hermes cron dashboard data to the Schedule tab format."""
    entries = []
    jobs = cron_data.get("jobs", [])
    for job in jobs:
        schedule = job.get("schedule", "")
        # Handle natural language schedules like "every 1m"
        if schedule.startswith("every"):
            description = schedule.capitalize()
        else:
            parts = schedule.split()
            if len(parts) == 5:
                description = _describe_schedule(parts[0], parts[1], parts[2], parts[3], parts[4])
            else:
                description = schedule

        # Get command from name since Hermes crons store command differently
        command = job.get("command", job.get("prompt", job.get("name", "")))

        # Next run
        next_runs = job.get("next_runs", [])
        next_run = next_runs[0] if next_runs else None

        entries.append({
            "id": job.get("id", ""),
            "source": "hermes",
            "schedule": schedule,
            "command": command,
            "owner": "hermes",
            "description": description,
            "name": job.get("name", ""),
            "status": job.get("status", "active"),
            "last_run": job.get("last_run"),
            "last_status": job.get("last_status"),
            "next_run": next_run,
        })
    return entries