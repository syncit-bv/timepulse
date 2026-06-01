// TimePulse dashboard

const DAY_MS = 86400000;
const $ = id => document.getElementById(id);

let currentDate = localDateString();
let gapsData = [];
let projects = [];

// ─── Auth ─────────────────────────────────────────────────────────────────────

let _sb = null;       // Supabase client
let _token = null;    // current access token

async function initAuth() {
  let config;
  try {
    config = await fetch('/api/config').then(r => r.json());
  } catch {
    return;
  }

  if (!config.supabaseUrl || !config.supabaseAnonKey) return;

  // detectSessionInUrl: false — we handle the URL hash manually below to
  // avoid a race condition with Supabase's own async hash processing.
  _sb = supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { detectSessionInUrl: false }
  });

  // Keep token current after background refreshes
  _sb.auth.onAuthStateChange((event, sess) => {
    if (event === 'TOKEN_REFRESHED' && sess) _token = sess.access_token;
  });

  // Tokens passed in URL hash by the Chrome extension's Dashboard button.
  // Format: #access_token=...&refresh_token=...&token_type=bearer&type=magiclink
  const hashParams = new URLSearchParams(window.location.hash.slice(1));
  const at = hashParams.get('access_token');
  const rt = hashParams.get('refresh_token');
  if (at) {
    // Strip hash immediately so it's not visible in the address bar
    history.replaceState(null, '', window.location.pathname + window.location.search);
    const { data, error } = await _sb.auth.setSession({ access_token: at, refresh_token: rt || '' });
    if (!error && data.session) {
      _token = data.session.access_token;
      showUserInfo(data.session.user.email);
      return;
    }
    // Token invalid / expired → fall through to login form
  }

  // Check for a persisted session in localStorage (returning visitor)
  const { data: { session } } = await _sb.auth.getSession();
  if (session) {
    _token = session.access_token;
    showUserInfo(session.user.email);
    return;
  }

  // No session at all — show login form and wait
  showLoginOverlay();
  await new Promise(resolve => {
    const { data: { subscription } } = _sb.auth.onAuthStateChange((event, sess) => {
      if (sess) {
        _token = sess.access_token;
        showUserInfo(sess.user.email);
        $('loginOverlay').style.display = 'none';
        subscription.unsubscribe();
        resolve();
      }
    });
  });
}

function showLoginOverlay() {
  $('loginOverlay').style.display = 'flex';
  $('loginEmail').focus();
}

function showUserInfo(email) {
  $('userEmail').textContent = email;
  $('userInfo').style.display = 'block';
}

$('loginBtn').addEventListener('click', async () => {
  const email    = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  const errEl    = $('loginError');
  errEl.style.display = 'none';

  if (!email || !password) {
    errEl.textContent = 'Vul je e-mailadres en wachtwoord in.';
    errEl.style.display = 'block';
    return;
  }

  const btn = $('loginBtn');
  btn.disabled = true;
  btn.textContent = 'Bezig…';

  try {
    const { error } = await _sb.auth.signInWithPassword({ email, password });
    if (error) {
      errEl.textContent = error.message;
      errEl.style.display = 'block';
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Aanmelden';
  }
});

$('loginPassword').addEventListener('keydown', e => {
  if (e.key === 'Enter') $('loginBtn').click();
});

$('logoutBtn').addEventListener('click', async () => {
  if (_sb) await _sb.auth.signOut();
  _token = null;
  $('userInfo').style.display = 'none';
  showLoginOverlay();
});

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  await initAuth();

  // Check for gap pre-select from Chrome extension
  const params = new URLSearchParams(location.search);
  const gapParam = params.get('gap');

  renderDateLabel();
  await Promise.all([loadHealth(), loadDay()]);

  if (gapParam) {
    const [start, end] = gapParam.split('-').map(Number);
    if (start && end) openModal({ start, end, domains: [] });
  }
}

// ─── Date navigation ──────────────────────────────────────────────────────────

$('prevDay').addEventListener('click', () => {
  currentDate = offsetDate(currentDate, -1);
  renderDateLabel();
  loadDay();
});
$('nextDay').addEventListener('click', () => {
  const next = offsetDate(currentDate, 1);
  if (next <= localDateString()) {
    currentDate = next;
    renderDateLabel();
    loadDay();
  }
});

function renderDateLabel() {
  const d = new Date(currentDate + 'T12:00:00');
  const today = localDateString();
  const yesterday = offsetDate(today, -1);
  let label;
  if (currentDate === today) label = 'Vandaag';
  else if (currentDate === yesterday) label = 'Gisteren';
  else label = d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
  $('dateLabel').textContent = label;
  $('nextDay').disabled = currentDate >= today;
}

// ─── Health check ─────────────────────────────────────────────────────────────

async function loadHealth() {
  const el = $('harvestStatus');
  try {
    const h = await fetchJson('/api/health');
    if (h.harvest) {
      el.innerHTML = '<span class="dot"></span> Harvest verbonden';
      el.className = 'harvest-status ok';
    } else {
      el.innerHTML = '<span class="dot"></span> Harvest niet ingesteld';
      el.className = 'harvest-status error';
    }
  } catch {
    el.innerHTML = '<span class="dot"></span> Server niet bereikbaar';
    el.className = 'harvest-status error';
  }
}

// ─── Load day data ─────────────────────────────────────────────────────────────

async function loadDay() {
  $('harvestList').innerHTML = '<div class="empty">Laden…</div>';
  $('gapsList').innerHTML = '<div class="empty">Laden…</div>';
  $('timelineTrack').innerHTML = '<div class="timeline-loading">Laden…</div>';

  try {
    const [gapResp, harvestResp] = await Promise.all([
      fetchJson(`/api/gaps/${currentDate}`).catch(() => null),
      fetchJson(`/api/entries/${currentDate}`).catch(() => null)
    ]);

    const entries = harvestResp?.entries || gapResp?.harvestEntries || [];
    const sessions = gapResp?.sessions || [];
    const gaps = gapResp?.gaps || [];
    gapsData = gaps;

    // Total hours
    const total = entries.reduce((s, e) => s + e.hours, 0);
    $('totalHours').textContent = total > 0 ? formatHours(total) : '0u';

    // Gaps alert
    const alert = $('gapsAlert');
    if (gaps.length > 0) {
      alert.style.display = 'block';
      $('gapsAlertCount').textContent = `${gaps.length} gat${gaps.length > 1 ? 'en' : ''}`;
      $('gapsAlertText').textContent = ` in je tijdsregistratie — klik op een gat om het toe te voegen aan Harvest.`;
    } else {
      alert.style.display = 'none';
    }

    renderTimeline(sessions, entries, gaps);
    renderHarvestEntries(entries);
    renderGaps(gaps);

  } catch (err) {
    console.error('loadDay error:', err);
    $('harvestList').innerHTML = `<div class="empty">Fout: ${escHtml(err.message)}</div>`;
  }
}

// ─── Timeline ─────────────────────────────────────────────────────────────────

const HOUR_START = 7;
const HOUR_END = 22;

function timeToPercent(ts) {
  const d = new Date(ts);
  const minuteOfDay = d.getHours() * 60 + d.getMinutes();
  const start = HOUR_START * 60;
  const end = HOUR_END * 60;
  return Math.max(0, Math.min(100, (minuteOfDay - start) / (end - start) * 100));
}

function renderTimeline(sessions, entries, gaps) {
  // Hour labels
  const hoursEl = $('timelineHours');
  hoursEl.innerHTML = '';
  for (let h = HOUR_START; h <= HOUR_END; h += 3) {
    const pct = (h - HOUR_START) / (HOUR_END - HOUR_START) * 100;
    const label = document.createElement('div');
    label.className = 'timeline-hour-label';
    label.style.top = pct + '%';
    label.textContent = `${h}:00`;
    hoursEl.appendChild(label);
  }

  const track = $('timelineTrack');
  track.innerHTML = '';

  // Activity sessions (browser activity)
  for (const sess of sessions) {
    const block = document.createElement('div');
    block.className = 'timeline-block activity';
    block.style.left = timeToPercent(sess.start) + '%';
    block.style.width = Math.max(.5, timeToPercent(sess.end) - timeToPercent(sess.start)) + '%';
    block.title = `Activiteit: ${formatTime(sess.start)} – ${formatTime(sess.end)}\n${sess.domains.join(', ')}`;
    track.appendChild(block);
  }

  // Harvest entries (if they have time info)
  for (const entry of entries) {
    if (entry.startedTime && entry.endedTime) {
      const startTs = parseHarvestTime(entry.spentDate, entry.startedTime);
      const endTs = parseHarvestTime(entry.spentDate, entry.endedTime);
      if (startTs && endTs) {
        const block = document.createElement('div');
        block.className = 'timeline-block harvest';
        block.style.left = timeToPercent(startTs) + '%';
        block.style.width = Math.max(.5, timeToPercent(endTs) - timeToPercent(startTs)) + '%';
        block.title = `Harvest: ${entry.project} — ${entry.task}`;
        track.appendChild(block);
      }
    }
  }

  // Gaps
  for (const gap of gaps) {
    const block = document.createElement('div');
    block.className = 'timeline-block gap';
    block.style.left = timeToPercent(gap.start) + '%';
    block.style.width = Math.max(1, timeToPercent(gap.end) - timeToPercent(gap.start)) + '%';
    block.title = `Gat: ${formatTime(gap.start)} – ${formatTime(gap.end)}`;
    block.addEventListener('click', () => openModal(gap));
    track.appendChild(block);
  }
}

// ─── Harvest entries list ──────────────────────────────────────────────────────

function renderHarvestEntries(entries) {
  const el = $('harvestList');
  if (entries.length === 0) {
    el.innerHTML = '<div class="empty">Nog geen tijdsregistraties in Harvest</div>';
    return;
  }
  el.innerHTML = entries.map(e => `
    <div class="harvest-entry">
      <div class="entry-info">
        <div class="entry-project">${escHtml(e.project)}</div>
        <div class="entry-task">${escHtml(e.task)}</div>
        ${e.notes ? `<div class="entry-notes">${escHtml(e.notes)}</div>` : ''}
      </div>
      <div class="entry-hours">${formatHours(e.hours)}</div>
    </div>
  `).join('');
}

// ─── Gaps list ────────────────────────────────────────────────────────────────

function renderGaps(gaps) {
  const badge = $('gapsBadge');
  if (gaps.length > 0) {
    badge.textContent = gaps.length;
    badge.style.display = 'inline';
  } else {
    badge.style.display = 'none';
  }

  const el = $('gapsList');
  if (gaps.length === 0) {
    el.innerHTML = '<div class="empty">Geen gaten — alles bijgehouden! ✓</div>';
    return;
  }

  el.innerHTML = '';
  for (const gap of gaps) {
    const dur = Math.round((gap.end - gap.start) / 60000);
    const div = document.createElement('div');
    div.className = 'gap-item';
    div.innerHTML = `
      <div class="gap-time">${formatTime(gap.start)} – ${formatTime(gap.end)}</div>
      <div class="gap-dur">${dur} minuten niet geregistreerd</div>
      ${gap.domains?.length ? `<div class="gap-domains">${escHtml(gap.domains.slice(0, 4).join(', '))}</div>` : ''}
      <button class="gap-add-btn">Toevoegen aan Harvest →</button>
    `;
    div.querySelector('.gap-add-btn').addEventListener('click', () => openModal(gap));
    el.appendChild(div);
  }
}

// ─── Modal ────────────────────────────────────────────────────────────────────

let modalGap = null;

async function openModal(gap) {
  modalGap = gap;
  $('modalBackdrop').style.display = 'flex';

  const startTime = tsToTimeInput(gap.start);
  const endTime = tsToTimeInput(gap.end);
  $('modalStart').value = startTime;
  $('modalEnd').value = endTime;
  updateModalDuration();

  $('modalDomains').textContent = gap.domains?.length
    ? gap.domains.join(', ')
    : 'Geen domeindata beschikbaar';

  $('modalNotes').value = '';

  // Load projects if not yet loaded
  if (projects.length === 0) {
    $('modalProject').innerHTML = '<option value="">Laden…</option>';
    $('modalTask').disabled = true;
    try {
      const resp = await fetchJson('/api/projects');
      projects = resp.projects;
      $('modalProject').innerHTML = '<option value="">Selecteer een project…</option>' +
        projects.map(p => `<option value="${p.id}">${escHtml(p.clientName ? `${p.clientName} — ${p.name}` : p.name)}</option>`).join('');
    } catch {
      $('modalProject').innerHTML = '<option value="">Fout bij laden projecten</option>';
    }
  }

  $('modalTask').innerHTML = '<option value="">Selecteer eerst een project</option>';
  $('modalTask').disabled = true;
}

function closeModal() {
  $('modalBackdrop').style.display = 'none';
  modalGap = null;
}

$('modalClose').addEventListener('click', closeModal);
$('modalCancel').addEventListener('click', closeModal);
$('modalBackdrop').addEventListener('click', e => { if (e.target === $('modalBackdrop')) closeModal(); });

$('modalProject').addEventListener('change', async () => {
  const projectId = $('modalProject').value;
  if (!projectId) {
    $('modalTask').innerHTML = '<option value="">Selecteer eerst een project</option>';
    $('modalTask').disabled = true;
    return;
  }
  $('modalTask').innerHTML = '<option value="">Laden…</option>';
  $('modalTask').disabled = true;
  try {
    const resp = await fetchJson(`/api/projects/${projectId}/tasks`);
    $('modalTask').innerHTML = '<option value="">Selecteer een taak…</option>' +
      resp.tasks.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
    $('modalTask').disabled = false;
  } catch {
    $('modalTask').innerHTML = '<option value="">Fout bij laden taken</option>';
  }
});

[$('modalStart'), $('modalEnd')].forEach(el => el.addEventListener('change', updateModalDuration));

function updateModalDuration() {
  const start = timeInputToMinutes($('modalStart').value);
  const end = timeInputToMinutes($('modalEnd').value);
  const diff = end - start;
  if (diff > 0) {
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    $('modalDuration').textContent = h > 0 ? `${h}u ${m}m` : `${m}m`;
  } else {
    $('modalDuration').textContent = '';
  }
}

$('modalSubmit').addEventListener('click', async () => {
  const projectId = $('modalProject').value;
  const taskId = $('modalTask').value;
  if (!projectId || !taskId) {
    alert('Selecteer een project en taak.');
    return;
  }

  const startMin = timeInputToMinutes($('modalStart').value);
  const endMin = timeInputToMinutes($('modalEnd').value);
  const hours = Math.round((endMin - startMin) / 60 * 100) / 100;
  if (hours <= 0) {
    alert('Eindtijd moet na begintijd liggen.');
    return;
  }

  const btn = $('modalSubmit');
  btn.disabled = true;
  btn.textContent = 'Bezig…';

  try {
    await fetchJson('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spentDate: currentDate,
        hours,
        projectId: Number(projectId),
        taskId: Number(taskId),
        notes: $('modalNotes').value.trim()
      })
    });
    closeModal();
    await loadDay();
  } catch (err) {
    alert(`Fout: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Toevoegen aan Harvest';
  }
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJson(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  let resp = await fetch(url, { ...options, headers });

  // Try a token refresh once on 401
  if (resp.status === 401 && _sb) {
    const { data } = await _sb.auth.refreshSession();
    if (data.session) {
      _token = data.session.access_token;
      headers['Authorization'] = `Bearer ${_token}`;
      resp = await fetch(url, { ...options, headers });
    } else {
      _token = null;
      showLoginOverlay();
      throw new Error('Aanmelden vereist');
    }
  }

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ error: resp.statusText }));
    throw new Error(err.detail || err.error || resp.statusText);
  }
  return resp.json();
}

function formatHours(h) {
  const hours = Math.floor(h);
  const mins = Math.round((h - hours) * 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}u`;
  return `${hours}u ${mins}m`;
}

function formatTime(ts) {
  return new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
}

function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function offsetDate(dateStr, days) {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

function tsToTimeInput(ts) {
  const d = new Date(ts);
  return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', hour12: false }).replace(':', ':');
}

function timeInputToMinutes(str) {
  if (!str) return 0;
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function parseHarvestTime(date, timeStr) {
  if (!date || !timeStr) return null;
  try { return new Date(`${date}T${timeStr}`).getTime(); } catch { return null; }
}

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

init();
