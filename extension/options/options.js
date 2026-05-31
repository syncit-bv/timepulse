const $ = id => document.getElementById(id);

async function load() {
  const result = await chrome.storage.sync.get(['serverUrl', 'idleMinutes', 'excludedDomains']);
  $('serverUrl').value = result.serverUrl || '';
  $('idleMinutes').value = result.idleMinutes || 5;
  $('excludedDomains').value = (result.excludedDomains || []).join('\n');
}

$('saveBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.trim().replace(/\/$/, '');
  const idleMinutes = parseInt($('idleMinutes').value, 10) || 5;
  const excludedDomains = $('excludedDomains').value
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  await chrome.storage.sync.set({ serverUrl, idleMinutes, excludedDomains });

  const status = $('status');
  status.textContent = 'Opgeslagen!';
  status.className = 'success';
  setTimeout(() => { status.textContent = ''; status.className = ''; }, 2000);
});

$('testBtn').addEventListener('click', async () => {
  const serverUrl = $('serverUrl').value.trim().replace(/\/$/, '');
  const dot = $('connDot');
  const label = $('connection-label');

  label.textContent = 'Verbinding testen…';
  dot.className = 'connection-dot';

  try {
    const resp = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      dot.className = 'connection-dot ok';
      label.textContent = 'Verbonden';
    } else {
      throw new Error(`HTTP ${resp.status}`);
    }
  } catch (err) {
    dot.className = 'connection-dot error';
    label.textContent = `Niet bereikbaar: ${err.message}`;
  }
});

// ─── Custom platforms ─────────────────────────────────────────────────────────

async function loadCustomPlatforms() {
  const { tp_custom_platforms = [] } = await chrome.storage.local.get('tp_custom_platforms');
  renderCustomPlatforms(tp_custom_platforms);
}

function renderCustomPlatforms(list) {
  const ul = $('customList');
  const empty = $('emptyMsg');
  ul.querySelectorAll('.platform-item').forEach(el => el.remove());
  empty.style.display = list.length ? 'none' : 'list-item';
  list.forEach(p => {
    const li = document.createElement('li');
    li.className = 'platform-item';
    li.dataset.slug = p.slug;
    li.innerHTML = `
      <span class="swatch" style="background:${p.color || '#6B7280'}"></span>
      <span class="name">${p.name}</span>
      <span class="urls">${p.urls.join(', ')}</span>
      <span class="del" title="Verwijderen">×</span>
    `;
    li.querySelector('.del').addEventListener('click', () => removePlatform(p.slug));
    ul.appendChild(li);
  });
}

async function removePlatform(slug) {
  const { tp_custom_platforms = [] } = await chrome.storage.local.get('tp_custom_platforms');
  const updated = tp_custom_platforms.filter(p => p.slug !== slug);
  await chrome.storage.local.set({ tp_custom_platforms: updated });
  renderCustomPlatforms(updated);
  await syncCustomToServer(updated);
}

$('addPlatformBtn').addEventListener('click', async () => {
  const slug  = $('newSlug').value.trim().toLowerCase().replace(/\s+/g, '-');
  const name  = $('newName').value.trim();
  const urls  = $('newUrls').value.split(',').map(s => s.trim()).filter(Boolean);

  if (!slug || !name || !urls.length) {
    alert('Vul slug, naam en minstens één URL-patroon in.');
    return;
  }

  const { tp_custom_platforms = [] } = await chrome.storage.local.get('tp_custom_platforms');
  const existing = tp_custom_platforms.findIndex(p => p.slug === slug);
  const entry = { slug, name, urls, color: '#6B7280', category: 'custom' };
  if (existing >= 0) tp_custom_platforms[existing] = entry;
  else tp_custom_platforms.push(entry);

  await chrome.storage.local.set({ tp_custom_platforms });
  renderCustomPlatforms(tp_custom_platforms);
  await syncCustomToServer(tp_custom_platforms);

  $('newSlug').value = '';
  $('newName').value = '';
  $('newUrls').value = '';
});

async function syncCustomToServer(platforms) {
  const { serverUrl } = await chrome.storage.sync.get('serverUrl');
  if (!serverUrl) return;
  for (const p of platforms) {
    try {
      await fetch(`${serverUrl.replace(/\/$/, '')}/api/platforms/custom`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(p),
        signal: AbortSignal.timeout(5000)
      });
    } catch {}
  }
}

load();
loadCustomPlatforms();
