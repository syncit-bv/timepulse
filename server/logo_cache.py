"""
Logo cache: downloads platform logos from logo.dev and serves them locally.

Flow:
  1. NAS fetches logos once at startup + daily via background task
  2. Logos stored as PNG files in data/logos/{slug}.png
  3. /api/logos/{slug} serves the cached file
  4. platforms.py injects local URL as primary icon source when available

logo.dev API:
  Search:  GET https://api.logo.dev/search?q={domain}&token={token}
           → [{"name": "...", "domain": "...", "img": "https://img.logo.dev/..."}, ...]
  Image:   GET https://img.logo.dev/{domain}?token={token}&size=64&format=png
"""

import asyncio
import os
from pathlib import Path

import httpx

LOGO_DIR = Path(os.getenv("DB_PATH", "./data/timepulse.db")).parent / "logos"
TOKEN     = os.getenv("LOGO_DEV_TOKEN", "")
BASE_IMG  = "https://img.logo.dev"
BASE_API  = "https://api.logo.dev"


def is_configured() -> bool:
    return bool(TOKEN)


def logo_path(slug: str) -> Path:
    return LOGO_DIR / f"{slug}.png"


def logo_exists(slug: str) -> bool:
    return logo_path(slug).exists()


async def fetch_logo(slug: str, domain: str) -> bool:
    """Download logo for a single platform. Returns True on success."""
    if not TOKEN:
        return False
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    url = f"{BASE_IMG}/{domain}?token={TOKEN}&size=64&format=png"
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True) as client:
            resp = await client.get(url)
            if resp.status_code == 200 and resp.headers.get("content-type", "").startswith("image"):
                logo_path(slug).write_bytes(resp.content)
                return True
    except Exception as e:
        print(f"[logo_cache] {slug} ({domain}): {e}")
    return False


async def search_logo(slug: str, query: str) -> bool:
    """Search logo.dev by name/domain query, download best match. Returns True on success."""
    if not TOKEN:
        return False
    LOGO_DIR.mkdir(parents=True, exist_ok=True)
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(f"{BASE_API}/search", params={"q": query, "token": TOKEN})
            if resp.status_code != 200:
                return False
            results = resp.json()
            if not results:
                return False
            # Take first result's domain and download
            best = results[0]
            img_url = f"{BASE_IMG}/{best['domain']}?token={TOKEN}&size=64&format=png"
            img_resp = await client.get(img_url, follow_redirects=True)
            if img_resp.status_code == 200 and img_resp.headers.get("content-type", "").startswith("image"):
                logo_path(slug).write_bytes(img_resp.content)
                print(f"[logo_cache] {slug} → found via search: {best['domain']}")
                return True
    except Exception as e:
        print(f"[logo_cache] search {slug}: {e}")
    return False


async def refresh_all(platforms: list, force: bool = False) -> dict:
    """
    Fetch missing (or all if force=True) logos for every platform.
    Returns a summary dict {slug: 'ok'|'skip'|'fail'}.
    """
    if not TOKEN:
        print("[logo_cache] Geen LOGO_DEV_TOKEN ingesteld — logo refresh overgeslagen.")
        return {}

    summary = {}
    for p in platforms:
        slug = p["slug"]

        if not force and logo_exists(slug):
            summary[slug] = "skip"
            continue

        # Derive primary domain from first URL pattern
        domain = p["urls"][0].lstrip("/").split("/")[0] if p.get("urls") else None
        if not domain:
            summary[slug] = "skip"
            continue

        ok = await fetch_logo(slug, domain)
        if not ok:
            # Fallback: try logo.dev search by platform name
            ok = await search_logo(slug, p["name"])

        summary[slug] = "ok" if ok else "fail"
        # Small delay to be a polite API consumer
        await asyncio.sleep(0.1)

    ok_count   = sum(1 for v in summary.values() if v == "ok")
    fail_count = sum(1 for v in summary.values() if v == "fail")
    skip_count = sum(1 for v in summary.values() if v == "skip")
    print(f"[logo_cache] Refresh klaar: {ok_count} nieuw, {skip_count} al gecacht, {fail_count} mislukt.")
    return summary


async def daily_refresh_loop(get_platforms_fn):
    """Background task: refresh logos once at startup, then every 24 hours."""
    # Short initial delay so the server is fully up first
    await asyncio.sleep(5)
    while True:
        platforms = get_platforms_fn()
        await refresh_all(platforms)
        await asyncio.sleep(24 * 3600)
