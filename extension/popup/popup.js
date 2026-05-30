const $ = id => document.getElementById(id);

async function getSettings() {
  const r = await chrome.storage.sync.get(['serverUrl']);
  return { serverUrl: (r.serverUrl || '').replace(/\/$/, '') };
}

async function fetchJson(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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

function minutesBetween(a, b) {
  return Math.round((b - a) / 60000);
}

async function init() {
  const { serverUrl } = await getSettings();
  const dot = $('connDot');

  if (!serverUrl) {
    $('harvestTotal').textContent = 'Server niet ingesteld';
    $('currentDomain').textContent = '—';
    dot.className = 'status-dot error';
    return;
  }

  dot.className = 'status-dot loading';

  // Active session from storage
  const session = await chrome.storage.session.get('activeTab');
  const tab = session.activeTab;
  if (tab && tab.url) {
    $('currentDomain').textContent = tab.domain || tab.url;
    $('currentMeta').textContent = tab.title || '';
  }

  try {
    const [health, summary, gaps] = await Promise.all([
      fetchJson(`${serverUrl}/api/health`),
      fetchJson(`${serverUrl}/api/today`),
      fetchJson(`${serverUrl}/api/gaps`)
    ]);

    dot.className = 'status-dot ok';

    // Harvest summary
    const total = summary.entries.reduce((s, e) => s + e.hours, 0);
    $('harvestTotal').textContent = total > 0 ? formatHours(total) : '0u geregistreerd';

    const entriesEl = $('harvestEntries');
    entriesEl.innerHTML = '';
    if (summary.entries.length === 0) {
      entriesEl.innerHTML = '<div class="empty">Nog geen registraties vandaag</div>';
    } else {
      for (const entry of summary.entries) {
        const div = document.createElement('div');
        div.className = 'entry';
        div.innerHTML = `
          <span class="entry-name">${escHtml(entry.project)} — ${escHtml(entry.task)}</span>
          <span class="entry-hours">${formatHours(entry.hours)}</span>
        `;
        entriesEl.appendChild(div);
      }
    }

    // Gaps
    const section = $('gapsSection');
    if (gaps.gaps && gaps.gaps.length > 0) {
      section.style.display = 'block';
      $('gapsCount').textContent = gaps.gaps.length;
      const list = $('gapsList');
      list.innerHTML = '';
      for (const gap of gaps.gaps) {
        const dur = minutesBetween(gap.start, gap.end);
        const div = document.createElement('div');
        div.className = 'gap';
        div.innerHTML = `
          <div class="gap-time">${formatTime(gap.start)} – ${formatTime(gap.end)}</div>
          <div class="gap-duration">${dur} minuten niet geregistreerd</div>
          ${gap.domains.length ? `<div class="gap-domains">${gap.domains.slice(0, 3).join(', ')}</div>` : ''}
          <button class="gap-btn" data-start="${gap.start}" data-end="${gap.end}" data-domains="${escAttr(gap.domains.join(','))}">
            Toevoegen aan Harvest →
          </button>
        `;
        list.appendChild(div);
      }
      list.querySelectorAll('.gap-btn').forEach(btn => {
        btn.addEventListener('click', () => openDashboardWithGap(serverUrl, btn.dataset));
      });
    } else {
      section.style.display = 'none';
    }

  } catch (err) {
    dot.className = 'status-dot error';
    $('harvestTotal').textContent = 'Server niet bereikbaar';
    console.error('TimePulse popup error:', err);
  }
}

function openDashboardWithGap(serverUrl, data) {
  const url = `${serverUrl}/?gap=${data.start}-${data.end}`;
  chrome.tabs.create({ url });
  window.close();
}

$('dashboardLink').addEventListener('click', async (e) => {
  e.preventDefault();
  const { serverUrl } = await getSettings();
  if (serverUrl) chrome.tabs.create({ url: serverUrl });
  else chrome.runtime.openOptionsPage();
  window.close();
});

$('optionsLink').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

function escHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

init();
