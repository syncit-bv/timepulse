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

load();
