const $ = id => document.getElementById(id);
let WORKDAY_HOURS = 8;

// ─── Auth ──────────────────────────────────────────────────────────────────────

let _supabaseUrl = '';
let _supabaseAnonKey = '';

async function loadSupabaseConfig() {
  const cached = await chrome.storage.local.get(['tp_supabase_url', 'tp_supabase_anon_key']);
  if (cached.tp_supabase_url) {
    _supabaseUrl    = cached.tp_supabase_url;
    _supabaseAnonKey = cached.tp_supabase_anon_key || '';
    return;
  }
  const { serverUrl } = await getSettings();
  if (!serverUrl) return;
  try {
    const resp = await fetch(`${serverUrl}/api/config`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      const cfg = await resp.json();
      _supabaseUrl     = cfg.supabaseUrl    || '';
      _supabaseAnonKey = cfg.supabaseAnonKey || '';
      await chrome.storage.local.set({
        tp_supabase_url:      _supabaseUrl,
        tp_supabase_anon_key: _supabaseAnonKey,
      });
    }
  } catch {}
}

async function getSession() {
  const r = await chrome.storage.local.get(['tp_access_token', 'tp_refresh_token', 'tp_user']);
  return { accessToken: r.tp_access_token || null, refreshToken: r.tp_refresh_token || null, user: r.tp_user || null };
}

async function saveSession(accessToken, refreshToken, user) {
  await chrome.storage.local.set({ tp_access_token: accessToken, tp_refresh_token: refreshToken, tp_user: user });
  // Push token to background so heartbeats include it
  chrome.runtime.sendMessage({ action: 'setAuthToken', token: accessToken }).catch(() => {});
}

async function clearSession() {
  await chrome.storage.local.remove(['tp_access_token', 'tp_refresh_token', 'tp_user']);
  chrome.runtime.sendMessage({ action: 'setAuthToken', token: null }).catch(() => {});
}

async function supabaseFetch(path, options = {}) {
  const resp = await fetch(`${_supabaseUrl}/auth/v1${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'apikey': _supabaseAnonKey,
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(8000),
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error_description || data.msg || `HTTP ${resp.status}`);
  return data;
}

async function signInEmail(email, password) {
  const data = await supabaseFetch('/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  await saveSession(data.access_token, data.refresh_token, data.user);
  return data.user;
}

async function signUpEmail(email, password) {
  const data = await supabaseFetch('/signup', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  // Supabase stuurt een bevestigingsmail — nog geen sessie
  return data;
}

async function signInWithProvider(provider) {
  const redirectUrl = chrome.identity.getRedirectURL();
  const url = `${_supabaseUrl}/auth/v1/authorize?` + new URLSearchParams({
    provider,
    redirect_to: redirectUrl,
  });
  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, async (responseUrl) => {
      if (chrome.runtime.lastError || !responseUrl) {
        return reject(new Error('Login geannuleerd'));
      }
      try {
        const hash   = new URL(responseUrl).hash.slice(1);
        const params = new URLSearchParams(hash);
        const token  = params.get('access_token');
        const refresh = params.get('refresh_token');
        if (!token) return reject(new Error('Geen token ontvangen'));

        // Haal user info op
        const user = await supabaseFetch('/user', {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        await saveSession(token, refresh, user);
        resolve(user);
      } catch (e) {
        reject(e);
      }
    });
  });
}

async function signOut() {
  const { accessToken } = await getSession();
  if (accessToken) {
    supabaseFetch('/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }).catch(() => {});
  }
  await clearSession();
}

// ─── Auth UI ──────────────────────────────────────────────────────────────────

function setAuthTab(tab) {
  ['signin', 'signup'].forEach(t => {
    $(`tab${t.charAt(0).toUpperCase() + t.slice(1)}`)?.classList.toggle('active', t === tab);
    $(`auth${t.charAt(0).toUpperCase() + t.slice(1)}`)?.style && ($(`auth${t.charAt(0).toUpperCase() + t.slice(1)}`).style.display = t === tab ? 'block' : 'none');
  });
}

function showAuthError(msg) {
  const el = $('authError');
  el.textContent = msg;
  el.style.display = 'block';
  $('authSuccess').style.display = 'none';
}

function showAuthSuccess(msg) {
  const el = $('authSuccess');
  el.textContent = msg;
  el.style.display = 'block';
  $('authError').style.display = 'none';
}

function hideAuthMessages() {
  $('authError').style.display = 'none';
  $('authSuccess').style.display = 'none';
}

$('tabSignin').addEventListener('click', () => { setAuthTab('signin'); hideAuthMessages(); });
$('tabSignup').addEventListener('click', () => { setAuthTab('signup'); hideAuthMessages(); });

$('siBtn').addEventListener('click', async () => {
  const email    = $('siEmail').value.trim();
  const password = $('siPassword').value;
  if (!email || !password) return showAuthError('Vul e-mail en wachtwoord in.');
  $('siBtn').textContent = 'Bezig…';
  $('siBtn').disabled = true;
  try {
    await loadSupabaseConfig();
    await signInEmail(email, password);
    showView('main');
    await loadData();
  } catch (e) {
    showAuthError(e.message);
  } finally {
    $('siBtn').textContent = 'Aanmelden';
    $('siBtn').disabled = false;
  }
});

$('suBtn').addEventListener('click', async () => {
  const email    = $('suEmail').value.trim();
  const password = $('suPassword').value;
  if (!email || password.length < 8) return showAuthError('Gebruik een geldig e-mail en wachtwoord van min. 8 tekens.');
  $('suBtn').textContent = 'Bezig…';
  $('suBtn').disabled = true;
  try {
    await loadSupabaseConfig();
    await signUpEmail(email, password);
    showAuthSuccess('Account aangemaakt! Bevestig je e-mailadres en meld je daarna aan.');
    setAuthTab('signin');
  } catch (e) {
    showAuthError(e.message);
  } finally {
    $('suBtn').textContent = 'Account aanmaken';
    $('suBtn').disabled = false;
  }
});

async function handleSocialLogin(provider) {
  hideAuthMessages();
  try {
    await loadSupabaseConfig();
    await signInWithProvider(provider);
    showView('main');
    await loadData();
  } catch (e) {
    showAuthError(e.message);
  }
}

$('googleBtn').addEventListener('click',    () => handleSocialLogin('google'));
$('microsoftBtn').addEventListener('click', () => handleSocialLogin('azure'));

// Uitloggen — toegankelijk via instellingen
async function handleSignOut() {
  await signOut();
  showView('auth');
}

// ─── Pomodoro ─────────────────────────────────────────────────────────────────
const POMO_WORK_SECS    = 25 * 60;
const POMO_SHORT_BREAK  =  5 * 60;
const POMO_LONG_BREAK   = 15 * 60;
const POMO_CYCLE_LONG   = 4;
const POMO_CIRCUMFERENCE = 2 * Math.PI * 34; // r=34

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
  const r = await chrome.storage.sync.get(['serverUrl', 'workdayHours']);
  return {
    serverUrl:    (r.serverUrl || '').replace(/\/$/, ''),
    workdayHours: r.workdayHours || 8
  };
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────
async function fetchJson(url, options = {}) {
  const { accessToken } = await getSession();
  const headers = { ...(options.headers || {}) };
  if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;
  const resp = await fetch(url, { ...options, headers, signal: AbortSignal.timeout(6000) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `HTTP ${resp.status}`);
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
  updateNowBar(session.activeTab);

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

// ─── View navigation ──────────────────────────────────────────────────────────
function showView(name) {
  $('viewAuth').style.display     = name === 'auth'     ? 'flex' : 'none';
  $('viewMain').style.display     = name === 'main'     ? 'flex' : 'none';
  $('viewSettings').style.display = name === 'settings' ? 'flex' : 'none';
  $('backBtn').style.display      = name === 'main'     ? 'none' : (name === 'auth' ? 'none' : 'inline-block');
  $('optBtn').style.display       = name === 'main'     ? 'inline-block' : 'none';
  $('connDot').style.display      = name === 'main'     ? 'inline-block' : 'none';
  $('connLabel').style.display    = name === 'main'     ? 'inline-block' : 'none';
  $('refreshBtn').style.display   = name === 'main'     ? 'inline-block' : 'none';
  // Footer nav hidden on auth view (not logged in)
  const loggedIn = name !== 'auth';
  $('dashBtn').style.display      = loggedIn ? 'inline-block' : 'none';
  $('optFooterBtn').style.display = loggedIn ? 'inline-block' : 'none';
  if (name === 'settings') loadSettingsForm();
}

async function loadSettingsForm() {
  const r = await chrome.storage.sync.get(['serverUrl', 'idleMinutes', 'excludedDomains', 'workdayHours']);
  $('cfgServerUrl').value  = r.serverUrl || '';
  $('cfgIdle').value       = r.idleMinutes || 5;
  $('cfgWorkday').value    = r.workdayHours || 8;
  $('cfgExcluded').value   = (r.excludedDomains || []).join('\n');
  $('cfgTestLabel').textContent = 'Nog niet getest';
  $('cfgDot').className = 'conn-dot';
  const { user } = await getSession();
  $('cfgUserEmail').textContent = user?.email || '–';
}

$('cfgTestBtn').addEventListener('click', async () => {
  const url = $('cfgServerUrl').value.trim().replace(/\/$/, '');
  const dot   = $('cfgDot');
  const label = $('cfgTestLabel');
  label.textContent = 'Testen…';
  dot.className = 'conn-dot pulse';
  try {
    const resp = await fetch(`${url}/api/config`, { signal: AbortSignal.timeout(15000) });
    if (resp.ok) {
      dot.className = 'conn-dot ok';
      label.textContent = 'Verbonden';
    } else {
      throw new Error(`HTTP ${resp.status}`);
    }
  } catch (err) {
    dot.className = 'conn-dot error';
    label.textContent = 'Niet bereikbaar';
  }
});

$('cfgSaveBtn').addEventListener('click', async () => {
  const serverUrl      = $('cfgServerUrl').value.trim().replace(/\/$/, '');
  const idleMinutes    = parseInt($('cfgIdle').value, 10) || 5;
  const workdayHours   = parseFloat($('cfgWorkday').value) || 8;
  const excludedDomains = $('cfgExcluded').value
    .split('\n').map(s => s.trim()).filter(Boolean);

  await chrome.storage.sync.set({ serverUrl, idleMinutes, workdayHours, excludedDomains });

  const msg = $('cfgSavedMsg');
  msg.textContent = 'Opgeslagen!';
  msg.classList.add('visible');
  setTimeout(() => msg.classList.remove('visible'), 2000);
});

$('backBtn').addEventListener('click', () => showView('main'));

$('cfgSignOutBtn').addEventListener('click', async () => {
  if (confirm('Wil je uitloggen?')) await handleSignOut();
});

// ─── Navigation ───────────────────────────────────────────────────────────────
$('dashBtn').addEventListener('click', async () => {
  const { serverUrl } = await getSettings();
  if (!serverUrl) { showView('settings'); return; }
  const { accessToken, refreshToken } = await getSession();
  let url = serverUrl;
  if (accessToken) {
    url += `/#access_token=${encodeURIComponent(accessToken)}&refresh_token=${encodeURIComponent(refreshToken || '')}&token_type=bearer&type=magiclink`;
  }
  chrome.tabs.create({ url });
});

$('optBtn').addEventListener('click', () => showView('settings'));
$('optFooterBtn').addEventListener('click', () => showView('settings'));
$('refreshBtn').addEventListener('click', () => loadData());
$('setupBtn')?.addEventListener('click', () => showView('settings'));

// ─── Real-time active tab updates ────────────────────────────────────────────
function updateNowBar(tab) {
  if (tab?.url) {
    $('nowBar').style.display = 'block';
    $('nowDomain').textContent = tab.domain || tab.url;
    $('nowTitle').textContent  = tab.title || '';
  } else {
    $('nowBar').style.display = 'none';
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' && changes.activeTab) {
    updateNowBar(changes.activeTab.newValue);
  }
});

// ─── Init ─────────────────────────────────────────────────────────────────────
let _refreshTimer = null;

async function init() {
  const { workdayHours } = await getSettings();
  WORKDAY_HOURS = workdayHours;

  await renderPomo();
  const pomoState = await getPomoState();
  if (pomoState.running) startPomoInterval();

  // Check of de gebruiker al ingelogd is
  const { accessToken } = await getSession();
  if (!accessToken) {
    showView('auth');
    return;
  }

  showView('main');
  await loadData();

  // Auto-refresh Harvest data every 60 seconds
  if (_refreshTimer) clearInterval(_refreshTimer);
  _refreshTimer = setInterval(async () => {
    const { accessToken: t } = await getSession();
    if (t) loadData();
  }, 60_000);
}

init();
