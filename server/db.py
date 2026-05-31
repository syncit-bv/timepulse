from __future__ import annotations

import asyncpg
import json
import os
import ssl

DATABASE_URL = os.getenv("DATABASE_URL", "")
_pool: asyncpg.Pool | None = None

_ssl_ctx = ssl.create_default_context()
_ssl_ctx.check_hostname = False
_ssl_ctx.verify_mode = ssl.CERT_NONE


async def _init_conn(conn):
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json",  encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def init():
    global _pool
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is not set")
    _pool = await asyncpg.create_pool(
        DATABASE_URL, min_size=2, max_size=10, init=_init_conn, ssl=_ssl_ctx
    )


async def close():
    global _pool
    if _pool:
        await _pool.close()
        _pool = None


# ── Heartbeats ────────────────────────────────────────────────────────────────

async def insert_heartbeat(user_id: str, hb: dict):
    await _pool.execute("""
        INSERT INTO heartbeats
            (user_id, timestamp, url, domain, title, favicon, activity_type, doc_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    """,
        user_id, hb["timestamp"], hb["url"], hb["domain"],
        hb.get("title", ""), hb.get("favicon"),
        hb.get("activityType", "website"), hb.get("docName"),
    )


async def insert_heartbeats_bulk(user_id: str, heartbeats: list):
    rows = [
        (user_id, h["timestamp"], h["url"], h["domain"],
         h.get("title", ""), h.get("favicon"),
         h.get("activityType", "website"), h.get("docName"))
        for h in heartbeats
        if h.get("url") and h.get("domain") and h.get("timestamp")
    ]
    if not rows:
        return
    await _pool.executemany("""
        INSERT INTO heartbeats
            (user_id, timestamp, url, domain, title, favicon, activity_type, doc_name)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
    """, rows)


async def insert_idle(user_id: str, state: str, timestamp: int):
    await _pool.execute(
        "INSERT INTO idle_events (user_id, state, timestamp) VALUES ($1, $2, $3)",
        user_id, state, timestamp,
    )


async def get_heartbeats_for_date(user_id: str, date_str: str) -> list:
    rows = await _pool.fetch("""
        SELECT timestamp, url, domain, title, activity_type, doc_name
        FROM   heartbeats
        WHERE  user_id = $1
          AND  to_char(
                 to_timestamp(timestamp / 1000.0) AT TIME ZONE 'Europe/Brussels',
                 'YYYY-MM-DD'
               ) = $2
        ORDER BY timestamp ASC
    """, user_id, date_str)
    return [dict(r) for r in rows]


# ── Harvest connection ────────────────────────────────────────────────────────

async def get_harvest_connection(user_id: str) -> dict | None:
    row = await _pool.fetchrow(
        "SELECT * FROM harvest_connections WHERE user_id = $1", user_id
    )
    return dict(row) if row else None


async def upsert_harvest_connection(user_id: str, data: dict):
    await _pool.execute("""
        INSERT INTO harvest_connections
            (user_id, access_token, refresh_token, account_id, account_name, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id) DO UPDATE SET
            access_token  = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            account_id    = EXCLUDED.account_id,
            account_name  = EXCLUDED.account_name,
            expires_at    = EXCLUDED.expires_at,
            updated_at    = NOW()
    """,
        user_id,
        data["access_token"],
        data.get("refresh_token"),
        str(data["account_id"]),
        data.get("account_name"),
        data.get("expires_at"),
    )


async def delete_harvest_connection(user_id: str):
    await _pool.execute(
        "DELETE FROM harvest_connections WHERE user_id = $1", user_id
    )


# ── Custom platforms ──────────────────────────────────────────────────────────

async def get_custom_platforms(user_id: str) -> list:
    rows = await _pool.fetch("""
        SELECT slug, name, urls, color, categories
        FROM   custom_platforms
        WHERE  user_id = $1
        ORDER BY created_at
    """, user_id)
    return [
        {"slug": r["slug"], "name": r["name"], "urls": r["urls"],
         "color": r["color"], "categories": r["categories"]}
        for r in rows
    ]


async def upsert_custom_platform(user_id: str, p: dict):
    await _pool.execute("""
        INSERT INTO custom_platforms (user_id, slug, name, urls, color, categories)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (user_id, slug) DO UPDATE SET
            name       = EXCLUDED.name,
            urls       = EXCLUDED.urls,
            color      = EXCLUDED.color,
            categories = EXCLUDED.categories
    """,
        user_id, p["slug"], p["name"],
        p["urls"], p.get("color", "#6B7280"), p.get("categories", ["custom"]),
    )


async def delete_custom_platform(user_id: str, slug: str):
    await _pool.execute(
        "DELETE FROM custom_platforms WHERE user_id = $1 AND slug = $2",
        user_id, slug,
    )
