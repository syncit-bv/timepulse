import asyncio
import os
import secrets
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

import db
import harvest as hv
import logo_cache as lc
import platforms as pf
from auth import require_user
from gap_analysis import build_sessions, find_gaps

load_dotenv()

# ── Startup / shutdown ────────────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        await db.init()
    except Exception as e:
        import traceback
        print(f"[FATAL] Database startup failed: {type(e).__name__}: {e}", flush=True)
        traceback.print_exc()
        raise
    print("TimePulse API gestart", flush=True)
    if lc.is_configured():
        asyncio.create_task(lc.daily_refresh_loop(pf.get_builtin_platforms))
    yield
    await db.close()


app = FastAPI(lifespan=lifespan, title="TimePulse API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Helpers ───────────────────────────────────────────────────────────────────

def today() -> str:
    return date.today().isoformat()


async def get_harvest_or_403(user_id: str) -> dict:
    conn = await db.get_harvest_connection(user_id)
    if not conn:
        raise HTTPException(403, "Harvest nog niet gekoppeld — ga naar Instellingen")
    return conn

# ── Pydantic models ───────────────────────────────────────────────────────────

class Heartbeat(BaseModel):
    url:          str
    domain:       str
    timestamp:    int
    title:        str = ""
    favicon:      Optional[str] = None
    activityType: str = "website"
    docName:      Optional[str] = None
    ticketId:     Optional[str] = None
    focusScore:   Optional[int] = None

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

# ── Config (public — geen auth nodig) ────────────────────────────────────────

@app.get("/api/config")
def config():
    return {
        "supabaseUrl":          os.getenv("SUPABASE_URL", ""),
        "supabaseAnonKey":      os.getenv("SUPABASE_ANON_KEY", ""),
        "harvestOauthEnabled":  hv.is_oauth_configured(),
        "version":              "2.0.0",
    }

# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health(user: dict = Depends(require_user)):
    conn = await db.get_harvest_connection(user["user_id"])
    return {
        "ok":           True,
        "harvest":      conn is not None,
        "harvestAccount": conn["account_name"] if conn else None,
        "logos":        lc.is_configured(),
        "version":      "2.0.0",
        "time":         datetime.utcnow().isoformat() + "Z",
    }

# ── Harvest OAuth2 ────────────────────────────────────────────────────────────

# Tijdelijke state-opslag (in productie: Redis of DB)
_oauth_states: dict[str, str] = {}

@app.get("/auth/harvest")
async def harvest_oauth_start(user: dict = Depends(require_user)):
    if not hv.is_oauth_configured():
        raise HTTPException(503, "Harvest OAuth niet geconfigureerd op de server")
    state = secrets.token_urlsafe(16)
    _oauth_states[state] = user["user_id"]
    return RedirectResponse(hv.authorization_url(state))


@app.get("/auth/harvest/callback")
async def harvest_oauth_callback(code: str, state: str):
    user_id = _oauth_states.pop(state, None)
    if not user_id:
        raise HTTPException(400, "Ongeldige of verlopen OAuth state")

    try:
        tokens   = await hv.exchange_code(code)
        accounts = await hv.get_accounts(tokens["access_token"])
        if not accounts:
            raise HTTPException(400, "Geen Harvest-account gevonden")
        account = accounts[0]
        await db.upsert_harvest_connection(user_id, {
            **tokens,
            "account_id":   account["id"],
            "account_name": account["name"],
        })
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Harvest koppeling mislukt: {e}")

    return HTMLResponse("""
        <html><head><title>Harvest gekoppeld</title></head>
        <body style="font-family:sans-serif;text-align:center;padding:60px">
          <h2>✅ Harvest succesvol gekoppeld!</h2>
          <p>Je kan dit venster sluiten.</p>
          <script>
            if (window.opener) { window.opener.postMessage('harvest_connected', '*'); }
            setTimeout(() => window.close(), 2000);
          </script>
        </body></html>
    """)


@app.delete("/auth/harvest")
async def harvest_disconnect(user: dict = Depends(require_user)):
    await db.delete_harvest_connection(user["user_id"])
    return {"ok": True}

# ── Tracking ──────────────────────────────────────────────────────────────────

@app.post("/api/heartbeat")
async def heartbeat(hb: Heartbeat, user: dict = Depends(require_user)):
    await db.insert_heartbeat(user["user_id"], hb.model_dump())
    return {"ok": True}


@app.post("/api/heartbeat/bulk")
async def heartbeat_bulk(body: HeartbeatBulk, user: dict = Depends(require_user)):
    await db.insert_heartbeats_bulk(user["user_id"], [h.model_dump() for h in body.heartbeats])
    return {"ok": True, "count": len(body.heartbeats)}


@app.post("/api/idle")
async def idle(event: IdleEvent, user: dict = Depends(require_user)):
    await db.insert_idle(user["user_id"], event.state, event.timestamp)
    return {"ok": True}


@app.get("/api/heartbeats/{date_str}")
async def heartbeats_for_date(date_str: str, user: dict = Depends(require_user)):
    hbs = await db.get_heartbeats_for_date(user["user_id"], date_str)
    return {"date": date_str, "heartbeats": hbs}

# ── Harvest data ──────────────────────────────────────────────────────────────

@app.get("/api/today")
async def today_entries(user: dict = Depends(require_user)):
    conn    = await get_harvest_or_403(user["user_id"])
    entries = await hv.get_time_entries(conn["access_token"], conn["account_id"], today())
    return {"date": today(), "entries": entries}


@app.get("/api/entries/{date_str}")
async def entries_for_date(date_str: str, user: dict = Depends(require_user)):
    conn    = await get_harvest_or_403(user["user_id"])
    entries = await hv.get_time_entries(conn["access_token"], conn["account_id"], date_str)
    return {"date": date_str, "entries": entries}


@app.post("/api/entries", status_code=201)
async def create_entry(body: NewEntry, user: dict = Depends(require_user)):
    if body.hours <= 0 or body.hours > 24:
        raise HTTPException(400, "hours moet tussen 0 en 24 liggen")
    conn   = await get_harvest_or_403(user["user_id"])
    result = await hv.create_time_entry(
        conn["access_token"], conn["account_id"],
        body.spentDate, body.hours, body.projectId, body.taskId, body.notes,
    )
    return result


@app.get("/api/projects")
async def projects(user: dict = Depends(require_user)):
    conn = await get_harvest_or_403(user["user_id"])
    return {"projects": await hv.get_projects(conn["access_token"], conn["account_id"])}


@app.get("/api/projects/{project_id}/tasks")
async def tasks(project_id: int, user: dict = Depends(require_user)):
    conn = await get_harvest_or_403(user["user_id"])
    return {"tasks": await hv.get_task_assignments(conn["access_token"], conn["account_id"], project_id)}

# ── Platforms ─────────────────────────────────────────────────────────────────

@app.get("/api/platforms")
async def get_platforms(request: Request, user: dict = Depends(require_user)):
    builtin = pf.get_builtin_platforms()
    custom  = await db.get_custom_platforms(user["user_id"])
    slugs_custom = {p["slug"] for p in custom}
    platforms = [p for p in builtin if p["slug"] not in slugs_custom] + custom
    base = str(request.base_url).rstrip("/")
    for p in platforms:
        if lc.logo_exists(p["slug"]):
            p["icon"] = f"{base}/api/logos/{p['slug']}"
    return {"platforms": platforms}


@app.get("/api/platforms/custom")
async def get_custom_platforms(user: dict = Depends(require_user)):
    return {"platforms": await db.get_custom_platforms(user["user_id"])}


@app.post("/api/platforms/custom", status_code=201)
async def save_custom_platform(body: CustomPlatform, user: dict = Depends(require_user)):
    if not body.slug or not body.urls:
        raise HTTPException(400, "slug en urls zijn verplicht")
    await db.upsert_custom_platform(user["user_id"], body.model_dump())
    return {"ok": True}


@app.delete("/api/platforms/custom/{slug}")
async def delete_custom_platform(slug: str, user: dict = Depends(require_user)):
    await db.delete_custom_platform(user["user_id"], slug)
    return {"ok": True}


@app.get("/api/logos/{slug}")
def serve_logo(slug: str):
    path = lc.logo_path(slug)
    if not path.exists():
        raise HTTPException(404, "Logo niet gevonden")
    return FileResponse(str(path), media_type="image/png")


@app.post("/api/logos/refresh")
async def refresh_logos(force: bool = False, user: dict = Depends(require_user)):
    if not lc.is_configured():
        raise HTTPException(503, "LOGO_DEV_TOKEN niet ingesteld")
    summary = await lc.refresh_all(pf.get_builtin_platforms(), force=force)
    ok   = sum(1 for v in summary.values() if v == "ok")
    fail = sum(1 for v in summary.values() if v == "fail")
    skip = sum(1 for v in summary.values() if v == "skip")
    return {"ok": True, "new": ok, "cached": skip, "failed": fail, "detail": summary}

# ── Gap analyse ───────────────────────────────────────────────────────────────

@app.get("/api/gaps")
async def gaps_today(user: dict = Depends(require_user)):
    return await _analyze_gaps(user["user_id"], today())


@app.get("/api/gaps/{date_str}")
async def gaps_for_date(date_str: str, user: dict = Depends(require_user)):
    return await _analyze_gaps(user["user_id"], date_str)


@app.get("/api/sessions/{date_str}")
async def sessions_for_date(date_str: str, user: dict = Depends(require_user)):
    hbs = await db.get_heartbeats_for_date(user["user_id"], date_str)
    return {"date": date_str, "sessions": build_sessions(hbs)}


async def _analyze_gaps(user_id: str, date_str: str):
    hbs             = await db.get_heartbeats_for_date(user_id, date_str)
    harvest_entries = []
    conn            = await db.get_harvest_connection(user_id)
    if conn:
        try:
            harvest_entries = await hv.get_time_entries(conn["access_token"], conn["account_id"], date_str)
        except Exception as e:
            print(f"Harvest ophalen mislukt voor gap analyse: {e}")
    gaps     = find_gaps(hbs, harvest_entries)
    sessions = build_sessions(hbs)
    return {"date": date_str, "gaps": gaps, "sessions": sessions, "harvestEntries": harvest_entries}

# ── Statische bestanden (dashboard) ──────────────────────────────────────────

PUBLIC_DIR = Path(__file__).parent / "public"
if PUBLIC_DIR.exists():
    app.mount("/", StaticFiles(directory=str(PUBLIC_DIR), html=True), name="static")

# ── Start ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=int(os.getenv("PORT", 3456)), reload=False)
