from __future__ import annotations

import asyncio

import httpx

DISCORD_API = "https://discord.com/api/v10"


async def dispatch_to_arete(task: str, skills: str | None = None) -> dict:
    """Send a task to ARETE via POST /v1/chat/completions. Returns session_id and response."""
    system_msg = "You are ARETE, an elite software engineering AI."
    if skills:
        system_msg += f" Use the skill '{skills}' if relevant."
    payload = {
        "model": "hermes-agent",
        "messages": [
            {"role": "system", "content": system_msg},
            {"role": "user", "content": task},
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post("http://localhost:8642/v1/chat/completions", json=payload)
            resp.raise_for_status()
            data = resp.json()

        session_id = data.get("id", "")
        choice = data.get("choices", [{}])[0]
        raw_response = str(choice.get("message", {}).get("content", ""))
        response = raw_response[:500]
        truncated = len(raw_response) > 500

        if not response and session_id:
            response = "(task dispatched)"

        return {
            "agent": "arete",
            "task": task,
            "session_id": session_id,
            "response": response,
            "truncated": truncated,
            "success": True,
            "error": None,
        }
    except asyncio.TimeoutError:
        return {
            "agent": "arete",
            "task": task,
            "success": False,
            "error": "Task timed out after 120s",
        }
    except httpx.ConnectError:
        return {
            "agent": "arete",
            "task": task,
            "success": False,
            "error": "Hermes API unreachable — is Hermes gateway running on port 8642?",
        }
    except httpx.HTTPStatusError as exc:
        return {
            "agent": "arete",
            "task": task,
            "success": False,
            "error": f"Hermes API error {exc.response.status_code}: {exc.response.text[:200]}",
        }
    except Exception as exc:
        return {
            "agent": "arete",
            "task": task,
            "success": False,
            "error": str(exc)[:200],
        }


async def dispatch_to_shu(
    task: str,
    channel_id: str,
    bot_token: str,
) -> dict:
    """Send a message to Shu's Discord channel."""
    if not bot_token:
        return {"agent": "shu", "task": task, "success": False, "error": "No Discord token"}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(
            f"{DISCORD_API}/channels/{channel_id}/messages",
            headers={
                "Authorization": f"Bot {bot_token}",
                "Content-Type": "application/json",
            },
            json={"content": f"**Dashboard dispatch:** {task}"},
        )
        if resp.is_success:
            return {
                "agent": "shu",
                "task": task,
                "success": True,
                "message_id": resp.json().get("id", ""),
            }
        else:
            return {
                "agent": "shu",
                "task": task,
                "success": False,
                "error": f"Discord HTTP {resp.status_code}: {resp.text[:200]}",
            }
