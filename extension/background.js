// TimePulse background service worker
// Tracks active tabs and forwards heartbeats to the NAS server.
//
// MV3 service workers get killed after ~30s of inactivity.
// We use chrome.alarms (not setInterval) to guarantee periodic wakeup.

const HEARTBEAT_ALARM = 'timepulse-heartbeat';
const HEARTBEAT_PERIOD_MINUTES = 0.5; // every 30 seconds
const IDLE_THRESHOLD_SECONDS = 300;   // 5 minutes fallback (Chrome idle API)
const BUFFER_MAX = 2880;              // ~24 hours of 30s heartbeats

// Content script reports real user movement every 15s.
// We track the last seen timestamp so the alarm knows if the user was
// actually active, rather than relying only on Chrome's coarse idle API.
const CONTENT_ACTIVE_WINDOW_MS = 20_000; // consider active if seen within 20s

// ─── Lifecycle ────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(setupAlarms);
chrome.runtime.onStartup.addListener(setupAlarms);

function setupAlarms() {
  chrome.alarms.get(HEARTBEAT_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
    }
  });
  chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);
}

// ─── State ────────────────────────────────────────────────────────────────────

// Kept in chrome.storage.session so it survives service worker restarts
// within the same browser session, but not across full browser restarts.
async function getActiveTab() {
  const result = await chrome.storage.session.get('activeTab');
  return result.activeTab || null;
}

async function setActiveTab(tab) {
  await chrome.storage.session.set({ activeTab: tab });
}

// ─── Content script messages ──────────────────────────────────────────────────
// Content script sends real-time activity with movement confirmation and rich context.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'contentActivity') return;

  const data = message.data;
  if (!data?.url || !data?.domain) return;

  // Update active tab with richer content-script data
  setActiveTab({
    url: data.url,
    domain: data.domain,
    title: data.title,
    favicon: data.favicon || null,
    activityType: data.activityType || 'website',
    docName: data.docName || null,
    tabId: sender.tab?.id,
    since: Date.now(),
    lastContentReport: Date.now()
  });
});

// ─── Tab tracking ─────────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await handleTabChange(tab);
  } catch {
    // Tab may have been closed already
  }
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab.active) return;
  await handleTabChange(tab);
});

async function handleTabChange(tab) {
  if (!tab.url || isInternalUrl(tab.url)) return;
  await setActiveTab({
    url: tab.url,
    domain: extractDomain(tab.url),
    title: tab.title || '',
    tabId: tab.id,
    since: Date.now()
  });
}

// ─── Idle detection ───────────────────────────────────────────────────────────

chrome.idle.onStateChanged.addListener(async (state) => {
  const { serverUrl } = await getSettings();
  if (!serverUrl) return;

  await postToServer(serverUrl, '/api/idle', {
    state,
    timestamp: Date.now()
  });
});

// ─── Heartbeat loop ───────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== HEARTBEAT_ALARM) return;
  await tick();
});

async function tick() {
  const tab = await getActiveTab();
  if (!tab) return;

  // Prefer content-script movement signal (10s granularity) over Chrome idle API (5min).
  // Fall back to Chrome idle API for tabs where content script can't run (e.g. PDFs, new tab).
  const contentScriptRecent = tab.lastContentReport
    && (Date.now() - tab.lastContentReport) < CONTENT_ACTIVE_WINDOW_MS;

  if (!contentScriptRecent) {
    const idleState = await new Promise(resolve => chrome.idle.queryState(IDLE_THRESHOLD_SECONDS, resolve));
    if (idleState !== 'active') return;
  }

  const heartbeat = {
    url: tab.url,
    domain: tab.domain,
    title: tab.title,
    favicon: tab.favicon || null,
    activityType: tab.activityType || 'website',
    docName: tab.docName || null,
    timestamp: Date.now()
  };

  const { serverUrl } = await getSettings();
  if (!serverUrl) {
    await bufferHeartbeat(heartbeat);
    return;
  }

  const ok = await postToServer(serverUrl, '/api/heartbeat', heartbeat);
  if (ok) {
    await flushBuffer(serverUrl);
    await updateBadge('ok');
  } else {
    await bufferHeartbeat(heartbeat);
    await updateBadge('offline');
  }
}

// ─── Buffering (offline support) ─────────────────────────────────────────────

async function bufferHeartbeat(heartbeat) {
  const { buffer = [] } = await chrome.storage.local.get('buffer');
  buffer.push(heartbeat);
  await chrome.storage.local.set({ buffer: buffer.slice(-BUFFER_MAX) });
}

async function flushBuffer(serverUrl) {
  const { buffer = [] } = await chrome.storage.local.get('buffer');
  if (buffer.length === 0) return;

  try {
    const resp = await fetch(`${serverUrl}/api/heartbeat/bulk`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ heartbeats: buffer }),
      signal: AbortSignal.timeout(10000)
    });
    if (resp.ok) {
      await chrome.storage.local.set({ buffer: [] });
    }
  } catch {
    // Will retry on next heartbeat
  }
}

// ─── HTTP ─────────────────────────────────────────────────────────────────────

async function postToServer(serverUrl, path, data) {
  try {
    const resp = await fetch(`${serverUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000)
    });
    return resp.ok;
  } catch {
    return false;
  }
}

// ─── Badge ────────────────────────────────────────────────────────────────────

async function updateBadge(status) {
  if (status === 'offline') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function getSettings() {
  const result = await chrome.storage.sync.get(['serverUrl']);
  return { serverUrl: (result.serverUrl || '').replace(/\/$/, '') };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractDomain(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

function isInternalUrl(url) {
  if (!url) return true;
  return /^(chrome|chrome-extension|edge|about|moz-extension):/.test(url);
}
