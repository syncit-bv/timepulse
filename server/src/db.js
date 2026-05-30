import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_PATH = process.env.DB_PATH || './data/timepulse.db';

// Ensure directory exists
const dir = path.dirname(path.resolve(DB_PATH));
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS heartbeats (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    url       TEXT    NOT NULL,
    domain    TEXT    NOT NULL,
    title     TEXT    DEFAULT '',
    date      TEXT    GENERATED ALWAYS AS (date(timestamp / 1000, 'unixepoch', 'localtime')) VIRTUAL
  );

  CREATE INDEX IF NOT EXISTS idx_heartbeats_timestamp ON heartbeats(timestamp);
  CREATE INDEX IF NOT EXISTS idx_heartbeats_date ON heartbeats(date);

  CREATE TABLE IF NOT EXISTS idle_events (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    state     TEXT    NOT NULL,
    timestamp INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_idle_timestamp ON idle_events(timestamp);
`);

export default db;
