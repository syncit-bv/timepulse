import sqlite3
import os
from pathlib import Path

DB_PATH = os.getenv("DB_PATH", "./data/timepulse.db")

def get_conn():
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init():
    with get_conn() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS heartbeats (
                id            INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp     INTEGER NOT NULL,
                url           TEXT    NOT NULL,
                domain        TEXT    NOT NULL,
                title         TEXT    DEFAULT '',
                favicon       TEXT    DEFAULT NULL,
                activity_type TEXT    DEFAULT 'website',
                doc_name      TEXT    DEFAULT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_hb_ts   ON heartbeats(timestamp);
            CREATE INDEX IF NOT EXISTS idx_hb_date ON heartbeats(
                date(timestamp / 1000, 'unixepoch', 'localtime')
            );

            CREATE TABLE IF NOT EXISTS idle_events (
                id        INTEGER PRIMARY KEY AUTOINCREMENT,
                state     TEXT    NOT NULL,
                timestamp INTEGER NOT NULL
            );
        """)

def insert_heartbeat(hb: dict):
    with get_conn() as conn:
        conn.execute("""
            INSERT INTO heartbeats (timestamp, url, domain, title, favicon, activity_type, doc_name)
            VALUES (:timestamp, :url, :domain, :title, :favicon, :activity_type, :doc_name)
        """, {
            "timestamp":     hb["timestamp"],
            "url":           hb["url"],
            "domain":        hb["domain"],
            "title":         hb.get("title", ""),
            "favicon":       hb.get("favicon"),
            "activity_type": hb.get("activityType", "website"),
            "doc_name":      hb.get("docName"),
        })

def insert_heartbeats_bulk(heartbeats: list):
    with get_conn() as conn:
        conn.executemany("""
            INSERT OR IGNORE INTO heartbeats (timestamp, url, domain, title, favicon, activity_type, doc_name)
            VALUES (:timestamp, :url, :domain, :title, :favicon, :activity_type, :doc_name)
        """, [{
            "timestamp":     h["timestamp"],
            "url":           h["url"],
            "domain":        h["domain"],
            "title":         h.get("title", ""),
            "favicon":       h.get("favicon"),
            "activity_type": h.get("activityType", "website"),
            "doc_name":      h.get("docName"),
        } for h in heartbeats if h.get("url") and h.get("domain") and h.get("timestamp")])

def insert_idle(state: str, timestamp: int):
    with get_conn() as conn:
        conn.execute("INSERT INTO idle_events (state, timestamp) VALUES (?, ?)", (state, timestamp))

def get_heartbeats_for_date(date_str: str) -> list:
    with get_conn() as conn:
        rows = conn.execute("""
            SELECT timestamp, url, domain, title, activity_type, doc_name
            FROM heartbeats
            WHERE date(timestamp / 1000, 'unixepoch', 'localtime') = ?
            ORDER BY timestamp ASC
        """, (date_str,)).fetchall()
        return [dict(r) for r in rows]
