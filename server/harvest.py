import os
import httpx

BASE_URL = "https://api.harvestapp.com/v2"

def _headers():
    return {
        "Authorization":    f"Bearer {os.getenv('HARVEST_ACCESS_TOKEN', '')}",
        "Harvest-Account-Id": os.getenv("HARVEST_ACCOUNT_ID", ""),
        "User-Agent":       "TimePulse/1.0",
        "Content-Type":     "application/json",
    }

def is_configured() -> bool:
    return bool(os.getenv("HARVEST_ACCESS_TOKEN") and os.getenv("HARVEST_ACCOUNT_ID"))

async def get_time_entries(date_str: str) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BASE_URL}/time_entries",
            params={"from": date_str, "to": date_str, "per_page": 100},
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    return [{
        "id":           e["id"],
        "hours":        e["hours"],
        "notes":        e.get("notes") or "",
        "project":      (e.get("project") or {}).get("name", ""),
        "projectId":    (e.get("project") or {}).get("id"),
        "task":         (e.get("task") or {}).get("name", ""),
        "taskId":       (e.get("task") or {}).get("id"),
        "spentDate":    e["spent_date"],
        "startedTime":  e.get("started_time"),
        "endedTime":    e.get("ended_time"),
    } for e in data.get("time_entries", [])]

async def create_time_entry(spent_date: str, hours: float, project_id: int, task_id: int, notes: str = "") -> dict:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{BASE_URL}/time_entries",
            json={
                "spent_date": spent_date,
                "hours":      round(hours, 2),
                "project_id": project_id,
                "task_id":    task_id,
                "notes":      notes,
            },
            headers=_headers(),
        )
        resp.raise_for_status()
        return resp.json()

async def get_projects() -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BASE_URL}/projects",
            params={"is_active": "true", "per_page": 100},
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    return [{
        "id":         p["id"],
        "name":       p["name"],
        "clientName": (p.get("client") or {}).get("name", ""),
    } for p in data.get("projects", [])]

async def get_task_assignments(project_id: int) -> list:
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BASE_URL}/projects/{project_id}/task_assignments",
            params={"is_active": "true", "per_page": 100},
            headers=_headers(),
        )
        resp.raise_for_status()
        data = resp.json()

    return [{
        "id":   (ta.get("task") or {}).get("id"),
        "name": (ta.get("task") or {}).get("name", ""),
    } for ta in data.get("task_assignments", [])]
