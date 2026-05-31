import os
import httpx
from datetime import datetime, timezone, timedelta

BASE_URL      = "https://api.harvestapp.com/v2"
AUTH_URL      = "https://id.getharvest.com/oauth2/authorize"
TOKEN_URL     = "https://id.getharvest.com/api/v2/oauth2/token"

CLIENT_ID     = os.getenv("HARVEST_CLIENT_ID", "")
CLIENT_SECRET = os.getenv("HARVEST_CLIENT_SECRET", "")
REDIRECT_URI  = os.getenv("HARVEST_REDIRECT_URI", "")


def is_oauth_configured() -> bool:
    return bool(CLIENT_ID and CLIENT_SECRET and REDIRECT_URI)


def authorization_url(state: str) -> str:
    from urllib.parse import urlencode
    params = urlencode({
        "client_id":     CLIENT_ID,
        "redirect_uri":  REDIRECT_URI,
        "response_type": "code",
        "state":         state,
    })
    return f"{AUTH_URL}?{params}"


def _headers(access_token: str, account_id: str) -> dict:
    return {
        "Authorization":      f"Bearer {access_token}",
        "Harvest-Account-Id": str(account_id),
        "User-Agent":         "TimePulse/1.0",
        "Content-Type":       "application/json",
    }


async def exchange_code(code: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(TOKEN_URL, data={
            "code":          code,
            "client_id":     CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "redirect_uri":  REDIRECT_URI,
            "grant_type":    "authorization_code",
        })
        resp.raise_for_status()
        data = resp.json()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
    return {
        "access_token":  data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "expires_at":    expires_at,
    }


async def get_accounts(access_token: str) -> list:
    """Fetch all Harvest accounts accessible with this token."""
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            "https://api.harvestapp.com/v2/accounts",
            headers={"Authorization": f"Bearer {access_token}", "User-Agent": "TimePulse/1.0"},
        )
        resp.raise_for_status()
        return resp.json().get("accounts", [])


async def refresh_access_token(refresh_token: str) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(TOKEN_URL, data={
            "refresh_token": refresh_token,
            "client_id":     CLIENT_ID,
            "client_secret": CLIENT_SECRET,
            "grant_type":    "refresh_token",
        })
        resp.raise_for_status()
        data = resp.json()
    expires_at = datetime.now(timezone.utc) + timedelta(seconds=data.get("expires_in", 3600))
    return {
        "access_token":  data["access_token"],
        "refresh_token": data.get("refresh_token"),
        "expires_at":    expires_at,
    }


# ── API calls ─────────────────────────────────────────────────────────────────

async def get_time_entries(access_token: str, account_id: str, date_str: str) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BASE_URL}/time_entries",
            params={"from": date_str, "to": date_str, "per_page": 100},
            headers=_headers(access_token, account_id),
        )
        resp.raise_for_status()
        data = resp.json()
    return [{
        "id":          e["id"],
        "hours":       e["hours"],
        "notes":       e.get("notes") or "",
        "project":     (e.get("project") or {}).get("name", ""),
        "projectId":   (e.get("project") or {}).get("id"),
        "task":        (e.get("task") or {}).get("name", ""),
        "taskId":      (e.get("task") or {}).get("id"),
        "spentDate":   e["spent_date"],
        "startedTime": e.get("started_time"),
        "endedTime":   e.get("ended_time"),
    } for e in data.get("time_entries", [])]


async def create_time_entry(
    access_token: str, account_id: str,
    spent_date: str, hours: float,
    project_id: int, task_id: int, notes: str = "",
) -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{BASE_URL}/time_entries",
            json={"spent_date": spent_date, "hours": round(hours, 2),
                  "project_id": project_id, "task_id": task_id, "notes": notes},
            headers=_headers(access_token, account_id),
        )
        resp.raise_for_status()
        return resp.json()


async def get_projects(access_token: str, account_id: str) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BASE_URL}/projects",
            params={"is_active": "true", "per_page": 100},
            headers=_headers(access_token, account_id),
        )
        resp.raise_for_status()
        data = resp.json()
    return [{
        "id":         p["id"],
        "name":       p["name"],
        "clientName": (p.get("client") or {}).get("name", ""),
    } for p in data.get("projects", [])]


async def get_task_assignments(access_token: str, account_id: str, project_id: int) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BASE_URL}/projects/{project_id}/task_assignments",
            params={"is_active": "true", "per_page": 100},
            headers=_headers(access_token, account_id),
        )
        resp.raise_for_status()
        data = resp.json()
    return [{
        "id":   (ta.get("task") or {}).get("id"),
        "name": (ta.get("task") or {}).get("name", ""),
    } for ta in data.get("task_assignments", [])]
