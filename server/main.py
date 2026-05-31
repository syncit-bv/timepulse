import os
import warnings
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import asyncio

import db
import harvest as hv
import logo_cache as lc
import platforms as pf
from gap_analysis import build_sessions, find_gaps

load_dotenv()

# ── Startup ───────────────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init()
    port = os.getenv("PORT", "3456")
    print(f"TimePulse server draait op http://0.0.0.0:{port}")
    if not hv.is_configured():
        warnings.warn("Harvest niet geconfigureerd — stel HARVEST_ACCESS_TOKEN en HARVEST_ACCOUNT_ID in .env in")
    if lc.is_configured():
        asyncio.create_task(lc.daily_refresh_loop(pf.get_platforms))
    else:
        warnings.warn("Logo.dev niet geconfigureerd — stel LOGO_DEV_TOKEN in .env in voor automatische logo's")
    yield

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def today() -> str:
    return date.today().isoformat()

def require_harvest():
    if not hv.is_configured():
        raise HTTPException(503, "Harvest niet geconfigureerd. Stel HARVEST_ACCESS_TOKEN en HARVEST_ACCOUNT_ID in via .env")

# ── Pydantic models ───────────────────────────────────────────────────────────

class Heartbeat(BaseModel):
    url:          str
    domain:       str
    timestamp:    int
    title:        str = ""
    favicon:      Optional[str] = None
    activityType: str = "website"
    docName:      Optional[str] = None

class HeartbeatBulk(BaseModel):
    heartbeats: list[Heartbeat]

class IdleEvent(BaseModel):
    state:     str
    timestamp: int

class NewEntry(BaseModel):
    spentDate:  str
    hours:      float
    projectId:  int
    taskId:     int
    notes:      str = ""

class CustomPlatform(BaseModel):
    slug:       str
    name:       str
    urls:       list[str]
    color:      str       = "#6B7280"
    categories: list[str] = ["custom"]

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
def health():
    return {
        "ok":      True,
        "harvest": hv.is_configured(),
        "logos":   lc.is_configured(),
        "version": "1.0.0",
        "time":    datetime.utcnow().isoformat() + "Z",
    }

# ── Tracking ──────────────────────────────────────────────────────────────────

@app.post("/api/heartbeat")
def heartbeat(hb: Heartbeat):
    db.insert_heartbeat(hb.model_dump())
    return {"ok": True}

@app.post("/api/heartbeat/bulk")
def heartbeat_bulk(body: HeartbeatBulk):
    db.insert_heartbeats_bulk([h.model_dump() for h in body.heartbeats])
    return {"ok": True, "count": len(body.heartbeats)}

@app.post("/api/idle")
def idle(event: IdleEvent):
    db.insert_idle(event.state, event.timestamp)
    return {"ok": True}

@app.get("/api/heartbeats/{date_str}")
def heartbeats_for_date(date_str: str):
    return {"date": date_str, "heartbeats": db.get_heartbeats_for_date(date_str)}

# ── Harvest ───────────────────────────────────────────────────────────────────

@app.get("/api/today")
async def today_entries():
    require_harvest()
    entries = await hv.get_time_entries(today())
    return {"date": today(), "entries": entries}

@app.get("/api/entries/{date_str}")
async def entries_for_date(date_str: str):
    require_harvest()
    entries = await hv.get_time_entries(date_str)
    return {"date": date_str, "entries": entries}

@app.post("/api/entries", status_code=201)
async def create_entry(body: NewEntry):
    require_harvest()
    if body.hours <= 0 or body.hours > 24:
        raise HTTPException(400, "hours moet tussen 0 en 24 liggen")
    result = await hv.create_time_entry(body.spentDate, body.hours, body.projectId, body.taskId, body.notes)
    return result

@app.get("/api/projects")
async def projects():
    require_harvest()
    return {"projects": await hv.get_projects()}

@app.get("/api/projects/{project_id}/tasks")
async def tasks(project_id: int):
    require_harvest()
    return {"tasks": await hv.get_task_assignments(project_id)}

# ── Platforms ────────────────────────────────────────────────────────────────

@app.get("/api/platforms")
def get_platforms(request: Request):
    platforms = pf.get_platforms()
    # Inject local logo URL when a cached file exists
    base = str(request.base_url).rstrip("/")
    for p in platforms:
        if lc.logo_exists(p["slug"]):
            p["icon"] = f"{base}/api/logos/{p['slug']}"
    return {"platforms": platforms}

@app.get("/api/platforms/custom")
def get_custom_platforms():
    return {"platforms": pf.get_custom_platforms()}

@app.post("/api/platforms/custom", status_code=201)
def save_custom_platform(body: CustomPlatform):
    if not body.slug or not body.urls:
        raise HTTPException(400, "slug en urls zijn verplicht")
    pf.save_custom_platform(body.model_dump())
    return {"ok": True}

@app.delete("/api/platforms/custom/{slug}")
def delete_custom_platform(slug: str):
    pf.delete_custom_platform(slug)
    return {"ok": True}

@app.get("/api/logos/{slug}")
def serve_logo(slug: str):
    path = lc.logo_path(slug)
    if not path.exists():
        raise HTTPException(404, "Logo niet gevonden")
    return FileResponse(str(path), media_type="image/png")

@app.post("/api/logos/refresh")
async def refresh_logos(force: bool = False):
    if not lc.is_configured():
        raise HTTPException(503, "LOGO_DEV_TOKEN niet ingesteld")
    summary = await lc.refresh_all(pf.get_platforms(), force=force)
    ok   = sum(1 for v in summary.values() if v == "ok")
    fail = sum(1 for v in summary.values() if v == "fail")
    skip = sum(1 for v in summary.values() if v == "skip")
    return {"ok": True, "new": ok, "cached": skip, "failed": fail, "detail": summary}

# ── Gap analyse ───────────────────────────────────────────────────────────────

@app.get("/api/gaps")
async def gaps_today():
    return await _analyze_gaps(today())

@app.get("/api/gaps/{date_str}")
async def gaps_for_date(date_str: str):
    return await _analyze_gaps(date_str)

@app.get("/api/sessions/{date_str}")
def sessions_for_date(date_str: str):
    heartbeats = db.get_heartbeats_for_date(date_str)
    return {"date": date_str, "sessions": build_sessions(heartbeats)}

async def _analyze_gaps(date_str: str):
    heartbeats = db.get_heartbeats_for_date(date_str)
    harvest_entries = []
    if hv.is_configured():
        try:
            harvest_entries = await hv.get_time_entries(date_str)
        except Exception as e:
            print(f"Harvest ophalen mislukt voor gap analyse: {e}")

    gaps     = find_gaps(heartbeats, harvest_entries)
    sessions = build_sessions(heartbeats)
    return {"date": date_str, "gaps": gaps, "sessions": sessions, "harvestEntries": harvest_entries}

# ── Demo seed ────────────────────────────────────────────────────────────────

DEMO_ENTRIES = [
    # (dag_offset, uren, notities)
    (0, 2.0,  "Ontwikkeling — TimePulse backend"),
    (0, 1.5,  "Klantoverleg Octagon Finance"),
    (0, 1.0,  "Code review & testing"),
    (1, 3.0,  "Ontwikkeling — Chrome extensie"),
    (1, 1.5,  "Documentatie bijwerken"),
    (2, 2.5,  "Ontwikkeling — dashboard UI"),
    (2, 1.0,  "Klantoverleg — voortgangsbespreking"),
    (2, 0.5,  "Facturatie & administratie"),
]

@app.post("/api/demo/seed", status_code=201)
async def seed_demo_entries(project_id: Optional[int] = None, task_id: Optional[int] = None):
    require_harvest()

    # Auto-detect eerste beschikbare project + taak als niet opgegeven
    if not project_id or not task_id:
        projects = await hv.get_projects()
        if not projects:
            raise HTTPException(404, "Geen actieve projecten gevonden in Harvest")
        project_id = project_id or projects[0]["id"]
        tasks = await hv.get_task_assignments(project_id)
        if not tasks:
            raise HTTPException(404, f"Geen taken gevonden voor project {project_id}")
        task_id = task_id or tasks[0]["id"]

    created = []
    errors  = []
    today   = date.today()

    for day_offset, hours, notes in DEMO_ENTRIES:
        spent_date = (today - timedelta(days=day_offset)).isoformat()
        try:
            entry = await hv.create_time_entry(spent_date, hours, project_id, task_id, notes)
            created.append({
                "id":        entry.get("id"),
                "spentDate": spent_date,
                "hours":     hours,
                "notes":     notes,
            })
        except Exception as e:
            errors.append({"spentDate": spent_date, "notes": notes, "error": str(e)})

    return {
        "ok":        True,
        "created":   len(created),
        "errors":    len(errors),
        "projectId": project_id,
        "taskId":    task_id,
        "entries":   created,
        "failed":    errors,
    }

# ── Statische bestanden (dashboard) ──────────────────────────────────────────

PUBLIC_DIR = Path(__file__).parent / "public"

if PUBLIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")

# ── Start ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", 3456)),
        reload=False,
    )
