import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import trackingRoutes from './routes/tracking.js';
import harvestRoutes from './routes/harvest.js';
import gapsRoutes from './routes/gaps.js';
import { isConfigured } from './services/harvestService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3456;

// CORS: allow all origins so the Chrome extension can reach the local NAS.
// Since this server is only reachable on your local network / behind auth,
// this is acceptable for a personal tool.
app.use(cors());
app.use(express.json());

// Static dashboard
app.use(express.static(path.join(__dirname, '../public')));

// API routes
app.use('/api', trackingRoutes);
app.use('/api', harvestRoutes);
app.use('/api', gapsRoutes);

// Health check (used by extension to test connectivity)
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    harvest: isConfigured(),
    version: '1.0.0',
    time: new Date().toISOString()
  });
});

// Serve dashboard for all non-API routes (SPA fallback)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`TimePulse server draait op http://0.0.0.0:${PORT}`);
  if (!isConfigured()) {
    console.warn('⚠  Harvest niet geconfigureerd — stel HARVEST_ACCESS_TOKEN en HARVEST_ACCOUNT_ID in .env in');
  }
});
