import { Router } from 'express';
import {
  getTimeEntries,
  createTimeEntry,
  getProjects,
  getTaskAssignments,
  isConfigured
} from '../services/harvestService.js';

const router = Router();

function requireConfig(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({
      error: 'Harvest niet geconfigureerd. Stel HARVEST_ACCESS_TOKEN en HARVEST_ACCOUNT_ID in via .env'
    });
  }
  next();
}

// Today's time entries + daily total
router.get('/today', requireConfig, async (req, res) => {
  try {
    const date = localDateString();
    const entries = await getTimeEntries(date);
    res.json({ date, entries });
  } catch (err) {
    console.error('Harvest /today error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// Entries for a specific date
router.get('/entries/:date', requireConfig, async (req, res) => {
  try {
    const entries = await getTimeEntries(req.params.date);
    res.json({ date: req.params.date, entries });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Create a new time entry
router.post('/entries', requireConfig, async (req, res) => {
  const { spentDate, hours, projectId, taskId, notes } = req.body;

  if (!spentDate || !hours || !projectId || !taskId) {
    return res.status(400).json({ error: 'spentDate, hours, projectId en taskId zijn verplicht' });
  }

  if (hours <= 0 || hours > 24) {
    return res.status(400).json({ error: 'hours moet tussen 0 en 24 liggen' });
  }

  try {
    const entry = await createTimeEntry({ spentDate, hours, projectId, taskId, notes });
    res.status(201).json(entry);
  } catch (err) {
    console.error('Harvest create entry error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// List active projects
router.get('/projects', requireConfig, async (req, res) => {
  try {
    const projects = await getProjects();
    res.json({ projects });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Tasks for a project
router.get('/projects/:id/tasks', requireConfig, async (req, res) => {
  try {
    const tasks = await getTaskAssignments(req.params.id);
    res.json({ tasks });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export default router;
