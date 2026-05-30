import { Router } from 'express';
import db from '../db.js';
import { getTimeEntries, isConfigured } from '../services/harvestService.js';
import { buildSessions, findGaps } from '../services/gapAnalysis.js';

const router = Router();

// Gaps for today (used by Chrome extension popup)
router.get('/gaps', async (req, res) => {
  const date = localDateString();
  res.json(await analyzeGaps(date));
});

// Gaps for a specific date (used by dashboard)
router.get('/gaps/:date', async (req, res) => {
  res.json(await analyzeGaps(req.params.date));
});

// Activity sessions for a date (for dashboard timeline)
router.get('/sessions/:date', (req, res) => {
  const heartbeats = db.prepare(`
    SELECT timestamp, domain, title
    FROM heartbeats WHERE date = ?
    ORDER BY timestamp ASC
  `).all(req.params.date);

  const sessions = buildSessions(heartbeats);
  res.json({ date: req.params.date, sessions });
});

async function analyzeGaps(date) {
  const heartbeats = db.prepare(`
    SELECT timestamp, domain, title
    FROM heartbeats WHERE date = ?
    ORDER BY timestamp ASC
  `).all(date);

  let harvestEntries = [];
  if (isConfigured()) {
    try {
      harvestEntries = await getTimeEntries(date);
    } catch (err) {
      console.warn('Could not fetch Harvest entries for gap analysis:', err.message);
    }
  }

  const gaps = findGaps(heartbeats, harvestEntries);
  const sessions = buildSessions(heartbeats);

  return { date, gaps, sessions, harvestEntries };
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default router;
