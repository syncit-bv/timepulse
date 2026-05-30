import { Router } from 'express';
import db from '../db.js';

const router = Router();

// Single heartbeat from extension
router.post('/heartbeat', (req, res) => {
  const { url, domain, title, timestamp, favicon, activityType, docName } = req.body;

  if (!url || !domain || !timestamp) {
    return res.status(400).json({ error: 'url, domain and timestamp required' });
  }

  db.prepare(`
    INSERT INTO heartbeats (timestamp, url, domain, title, favicon, activity_type, doc_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(timestamp, url, domain, title || '', favicon || null, activityType || 'website', docName || null);

  res.json({ ok: true });
});

// Bulk heartbeats (flushed from offline buffer)
router.post('/heartbeat/bulk', (req, res) => {
  const { heartbeats } = req.body;

  if (!Array.isArray(heartbeats) || heartbeats.length === 0) {
    return res.status(400).json({ error: 'heartbeats array required' });
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO heartbeats (timestamp, url, domain, title, favicon, activity_type, doc_name)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((items) => {
    for (const hb of items) {
      if (hb.url && hb.domain && hb.timestamp) {
        insert.run(
          hb.timestamp, hb.url, hb.domain, hb.title || '',
          hb.favicon || null, hb.activityType || 'website', hb.docName || null
        );
      }
    }
  });

  insertMany(heartbeats);
  res.json({ ok: true, count: heartbeats.length });
});

// Idle state change
router.post('/idle', (req, res) => {
  const { state, timestamp } = req.body;
  if (!state || !timestamp) return res.status(400).json({ error: 'state and timestamp required' });

  db.prepare(`INSERT INTO idle_events (state, timestamp) VALUES (?, ?)`).run(state, timestamp);
  res.json({ ok: true });
});

// Heartbeat data for a specific date (for dashboard)
router.get('/heartbeats/:date', (req, res) => {
  const { date } = req.params;
  const rows = db.prepare(`
    SELECT timestamp, domain, title
    FROM heartbeats
    WHERE date = ?
    ORDER BY timestamp ASC
  `).all(date);

  res.json({ date, heartbeats: rows });
});

export default router;
