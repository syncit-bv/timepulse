const $ = id => document.getElementById(id);
const WORKDAY_HOURS = 8;

// ─── Pomodoro ─────────────────────────────────────────────────────────────────
const POMO_WORK_SECS    = 25 * 60;
const POMO_SHORT_BREAK  =  5 * 60;
const POMO_LONG_BREAK   = 15 * 60;
const POMO_CYCLE_LONG   = 4;
const POMO_CIRCUMFERENCE = 2 * Math.PI * 54; // r=54

let pomoInterval = null;

async function getPomoState() {
  const r = await chrome.storage.session.get('pomodoroState');
  return r.pomodoroState || {
    running: false, phase: 'work', cycle: 0,
    startedAt: 0, duration: POMO_WORK_SECS, elapsed: 0
  };
}

async function setPomoState(state) {
  await chrome.storage.session.set({ pomodoroState: state });
}

function pomoRemaining(state) {
  if (!state.running) return Math.max(0, state.duration - state.elapsed);
  const elapsed = state.elapsed + (Date.now() - state.startedAt) / 1000;
  return Math.max(0, state.duration - elapsed);
}

function formatPomoTime(secs) {
  const m = Math.floor(secs / 60).toString().padStart(2, '0');
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

const PHASE_LABELS = { work: 'Focus', short: 'Korte pauze', long: 'Lange pauze' };
const PHASE_COLORS = { work: '#6366f1', short: '#22c55e', long: '#3b82f6' };

async function renderPomo() {
  const state = await getPomoState();
  const remaining = pomoRemaining(state);

  $('pomoTime').textContent  = formatPomoTime(remaining);
  $('pomoPhase').textContent = PHASE_LABELS[state.phase] || state.phase;

  // Ring: dashoffset = circumference when empty, 0 when full
  const progress = 1 - remaining / state.duration;
  $('pomoRing').style.strokeDashoffset = POMO_CIRCUMFERENCE * progress;
  $('pomoRing').style.stroke = PHASE_COLORS[state.phase] || '#6366f1';

  // Cycle dots
  const dots = $('pomoCycles');
  dots.innerHTML = '';
  for (let i = 0; i < POMO_CYCLE_LONG; i++) {
    const dot = document.createElement('span');
    dot.className = 'cycle-dot' + (i < (state.cycle % POMO_CYCLE_LONG) ? ' filled' : '');
    dots.appendChild(dot);
  }

  // Start button label + color
  const btn = $('pomoBtnStart');
  if (state.running) {
    btn.textContent = 'Pauzeren';
    btn.classList.add('running');
  } else {
    btn.textContent = state.elapsed > 0 ? 'Hervatten' : 'Starten';
    btn.classList.remove('running');
  }

  // Auto-advance when done
  if (state.running && remaining <= 0) {
    await advancePomo(state);
  }
}

async function advancePomo(state) {
  stopPomoInterval();
  let newState;
  if (state.phase === 'work') {
    const newCycle = state.cycle + 1;
    const isLong   = newCycle % POMO_CYCLE_LONG === 0;
    newState = {
      running: false,
      phase: isLong ? 'long' : 'short',
      cycle: newCycle,
      startedAt: 0,
      duration: isLong ? POMO_LONG_BREAK : POMO_SHORT_BREAK,
      elapsed: 0
    };
  } else {
    newState = {
      running: false, phase: 'work', cycle: state.cycle,
      startedAt: 0, duration: POMO_WORK_SECS, elapsed: 0
    };
  }
  await setPomoState(newState);
  await renderPomo();
}

function startPomoInterval() {
  stopPomoInterval();
  pomoInterval = setInterval(renderPomo, 500);
}

function stopPomoInterval() {
  if (pomoInterval) { clearInterval(pomoInterval); pomoInterval = null; }
}

$('pomoBtnStart').addEventListener('click', async () => {
  const state = await getPomoState();
  if (state.running) {
    const elapsed = state.elapsed + (Date.now() - state.startedAt) / 1000;
    await setPomoState({ ...state, running: false, elapsed });
    stopPomoInterval();
  } else {
    await setPomoState({ ...state, running: true, startedAt: Date.now() });
    startPomoInterval();
  }
  await renderPomo();
});

$('pomoBtnReset').addEventListener('click', async () => {
  const state = await getPomoState();
  await setPomoState({ ...state, running: false, elapsed: 0, startedAt: 0 });
  stopPomoInterval();
  await renderPomo();
});

$('pomoBtnSkip').addEventListener('click', async () => {
  const state = await getPomoState();
  await advancePomo(state);
});

// Sync when background service worker advances the timer (e.g. via alarm)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes.pomodoroState) return;
  const newState = changes.pomodoroState.newValue;
  if (newState && !newState.running) stopPomoInterval();
  renderPomo();
});

// ─── Settings ─────────────────────────────────────────────────────────────────
async function getSettings() {
  const r = await chrome.storage.sync.get(['serverUrl']);
  return { serverUrl: (r.serverUrl || '').replace(/\/$/, '') };
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────
async function fetchJson(url, options) {
  const resp = await fetch(url, { ...options, signal: AbortSignal.timeout(6000) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

// ─── Formatters ───────────────────────────────────────────────────────────────
function formatHours(h) {
  const hrs  = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0)  return `${mins}min`;
  if (mins === 0) return `${hrs}u`;
  return `${hrs}u ${mins}min`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
}

function escHtml(str) {
  return String(str || '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ─── Harvest + connection ─────────────────────────────────────────────────────
async function loadData() {
  const { serverUrl } = await getSettings();
  const dot   = $('connDot');
  const label = $('connLabel');

  if (!serverUrl) {
    $('setupPrompt').style.display = 'block';
    $('heroHours').textContent = '–';
    dot.className = 'conn-dot error';
    label.textContent = 'Niet ingesteld';
    return;
  }

  // Active tab
  const session = await chrome.storage.session.get('activeTab');
  const tab = session.activeTab;
  if (tab?.url) {
    $('nowBar').style.display = 'block';
    $('nowDomain').textContent = tab.domain || tab.url;
    $('nowTitle').textContent  = tab.title || '';
  }

  dot.className = 'conn-dot pulse';
  label.textContent = 'Verbinden…';

  try {
    const [health, today, gapData] = await Promise.all([
      fetchJson(`${serverUrl}/api/health`),
      fetchJson(`${serverUrl}/api/today`).catch(() => ({ entries: [] })),
      fetchJson(`${serverUrl}/api/gaps`).catch(() => ({ gaps: [] }))
    ]);

    dot.className = 'conn-dot ok';
    label.textContent = health.harvest ? 'Harvest verbonden' : 'Harvest niet ingesteld';

    renderHero(today.entries || []);
    renderGaps(gapData.gaps || [], serverUrl);
  } catch {
    dot.className = 'conn-dot error';
    label.textContent = 'Niet bereikbaar';
    $('heroHours').textContent = '–';
  }
}

function renderHero(entries) {
  const total = entries.reduce((s, e) => s + e.hours, 0);
  $('heroHours').textContent = total > 0 ? formatHours(total) : '0u';

  const pct = Math.min(100, Math.round(total / WORKDAY_HOURS * 100));
  $('heroBarFill').style.width = `${pct}%`;
  $('heroBarGoal').textContent = `${pct}% van ${WORKDAY_HOURS}u`;

  const pills = $('entryPills');
  pills.innerHTML = '';
  if (entries.length === 0) {
    pills.innerHTML = '<span class="pill">Nog niets ingeboekt</span>';
    return;
  }
  entries.slice(0, 6).forEach(e => {
    const pill = document.createElement('span');
    pill.className = 'pill';
    pill.innerHTML = `${escHtml(e.project)} <span class="pill-hours">${formatHours(e.hours)}</span>`;
    pill.title = e.task;
    pills.appendChild(pill);
  });
}

function renderGaps(gaps, serverUrl) {
  const section = $('gapsSection');
  if (!gaps.length) { section.style.display = 'none'; return; }
  section.style.display = 'block';
  $('gapsBadge').textContent = gaps.length;
  const list = $('gapsList');
  list.innerHTML = '';
  gaps.slice(0, 5).forEach(gap => {
    const dur  = Math.round((gap.end - gap.start) / 60000);
    const item = document.createElement('div');
    item.className = 'gap-item';
    item.innerHTML = `
      <div class="gap-info">
        <div class="gap-time">${formatTime(gap.start)} – ${formatTime(gap.end)}</div>
        <div class="gap-dur">${dur} min niet geregistreerd</div>
        ${gap.domains?.length ? `<div class="gap-domains">${escHtml(gap.domains.slice(0,3).join(', '))}</div>` : ''}
      </div>
      <button class="gap-cta">Boeken →</button>
    `;
    item.querySelector('.gap-cta').addEventListener('click', async () => {
      const { serverUrl: url } = await getSettings();
      chrome.tabs.create({ url: `${url}/?gap=${gap.start}-${gap.end}` });
    });
    list.appendChild(item);
  });
}

// ─── Navigation ───────────────────────────────────────────────────────────────
$('dashBtn').addEventListener('click', async () => {
  const { serverUrl } = await getSettings();
  if (serverUrl) chrome.tabs.create({ url: serverUrl });
  else chrome.runtime.openOptionsPage();
});

$('optBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('optFooterBtn').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('refreshBtn').addEventListener('click', () => loadData());
$('setupBtn')?.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  await renderPomo();
  const state = await getPomoState();
  if (state.running) startPomoInterval();
  await loadData();
}

init();
