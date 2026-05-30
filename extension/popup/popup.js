const $ = id => document.getElementById(id);
const WORKDAY_HOURS = 8; // for progress bar (adjustable)

async function getSettings() {
  const r = await chrome.storage.sync.get(['serverUrl']);
  return { serverUrl: (r.serverUrl || '').replace(/\/$/, '') };
}

async function fetchJson(url, options) {
  const resp = await fetch(url, { ...options, signal: AbortSignal.timeout(6000) });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

function formatHours(h) {
  const hrs = Math.floor(h);
  const mins = Math.round((h - hrs) * 60);
  if (hrs === 0) return `${mins}min`;
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

async function init() {
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

  // Show current active tab
  const session = await chrome.storage.session.get('activeTab');
  const tab = session.activeTab;
  if (tab?.url) {
    $('nowBar').style.display = 'block';
    $('nowDomain').textContent = tab.domain || tab.url;
    $('nowTitle').textContent  = tab.title || '';
  }

  // Connection check + data load in parallel
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

  // Progress bar toward workday goal
  const pct = Math.min(100, Math.round(total / WORKDAY_HOURS * 100));
  $('heroBarFill').style.width = `${pct}%`;
  $('heroBarGoal').textContent = `${pct}% van ${WORKDAY_HOURS}u`;

  // Entry pills (project summary)
  const pills = $('entryPills');
  pills.innerHTML = '';
  if (entries.length === 0) {
    pills.innerHTML = '<span class="pill">Nog niets ingeboekt</span>';
    return;
  }
  entries.slice(0, 4).forEach(e => {
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

  gaps.slice(0, 4).forEach(gap => {
    const dur = Math.round((gap.end - gap.start) / 60000);
    const item = document.createElement('div');
    item.className = 'gap-item';
    item.innerHTML = `
      <div class="gap-info">
        <div class="gap-time">${formatTime(gap.start)} – ${formatTime(gap.end)}</div>
        <div class="gap-dur">${dur} min niet geregistreerd</div>
        ${gap.domains?.length ? `<div class="gap-domains">${escHtml(gap.domains.slice(0,2).join(', '))}</div>` : ''}
      </div>
      <button class="gap-cta">Boeken →</button>
    `;
    item.querySelector('.gap-cta').addEventListener('click', () => {
      chrome.tabs.create({ url: `${serverUrl}/?gap=${gap.start}-${gap.end}` });
      window.close();
    });
    list.appendChild(item);
  });
}

$('dashBtn').addEventListener('click', async () => {
  const { serverUrl } = await getSettings();
  if (serverUrl) chrome.tabs.create({ url: serverUrl });
  else chrome.runtime.openOptionsPage();
  window.close();
});

$('optBtn').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

$('setupBtn')?.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});

init();
