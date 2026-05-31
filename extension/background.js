// TimePulse background service worker
// Tracks active tabs and forwards heartbeats to the NAS server.
//
// MV3 service workers get killed after ~30s of inactivity.
// We use chrome.alarms (not setInterval) to guarantee periodic wakeup.

const HEARTBEAT_ALARM  = 'timepulse-heartbeat';
const PLATFORMS_ALARM  = 'timepulse-platforms';
const POMODORO_ALARM   = 'timepulse-pomodoro';
const HEARTBEAT_PERIOD_MINUTES = 0.5;  // every 30 seconds
const PLATFORMS_PERIOD_MINUTES = 1440; // refresh platforms once a day

const POMO_WORK_SECS   = 25 * 60;
const POMO_SHORT_BREAK =  5 * 60;
const POMO_LONG_BREAK  = 15 * 60;
const POMO_CYCLE_LONG  = 4;
const IDLE_THRESHOLD_SECONDS   = 300;  // 5 minutes fallback (Chrome idle API)
const BUFFER_MAX = 2880;               // ~24 hours of 30s heartbeats

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
  chrome.alarms.get(PLATFORMS_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(PLATFORMS_ALARM, { periodInMinutes: PLATFORMS_PERIOD_MINUTES });
    }
  });
  chrome.alarms.get(POMODORO_ALARM, (existing) => {
    if (!existing) {
      chrome.alarms.create(POMODORO_ALARM, { periodInMinutes: 1 });
    }
  });
  chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);

  // Open side panel when action icon is clicked
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }

  refreshPlatforms();
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
  if (alarm.name === HEARTBEAT_ALARM) await tick();
  if (alarm.name === PLATFORMS_ALARM) await refreshPlatforms();
  if (alarm.name === POMODORO_ALARM)  await checkPomodoroAlarm();
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

// ─── Pomodoro notifications ───────────────────────────────────────────────────

async function checkPomodoroAlarm() {
  const { pomodoroState } = await chrome.storage.session.get('pomodoroState');
  if (!pomodoroState?.running) return;

  const elapsed = pomodoroState.elapsed + (Date.now() - pomodoroState.startedAt) / 1000;
  if (elapsed < pomodoroState.duration) return;

  const wasWork  = pomodoroState.phase === 'work';
  const newCycle = wasWork ? pomodoroState.cycle + 1 : pomodoroState.cycle;
  const isLong   = wasWork && newCycle % POMO_CYCLE_LONG === 0;

  const newState = wasWork
    ? { running: false, phase: isLong ? 'long' : 'short', cycle: newCycle,
        startedAt: 0, duration: isLong ? POMO_LONG_BREAK : POMO_SHORT_BREAK, elapsed: 0 }
    : { running: false, phase: 'work', cycle: pomodoroState.cycle,
        startedAt: 0, duration: POMO_WORK_SECS, elapsed: 0 };

  await chrome.storage.session.set({ pomodoroState: newState });

  chrome.notifications.create('timepulse-pomo-done', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: wasWork ? '🍅 Pomodoro voltooid!' : '⏰ Pauze voorbij!',
    message: wasWork
      ? `Focus #${newCycle} afgerond. ${isLong ? 'Lange pauze!' : 'Korte pauze!'}`
      : 'Klaar voor een nieuwe focussessie?'
  });
}

// ─── Platform definitions ─────────────────────────────────────────────────────

async function refreshPlatforms() {
  const { serverUrl } = await getSettings();
  if (!serverUrl) return;

  try {
    const resp = await fetch(`${serverUrl}/api/platforms`, {
      signal: AbortSignal.timeout(10000)
    });
    if (!resp.ok) return;
    const data = await resp.json();
    if (data.platforms?.length) {
      await chrome.storage.local.set({ tp_platforms: data.platforms });
    }
  } catch {
    // Server unreachable — keep using cached platforms
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
